// 图表纯绘制函数：从 components/{donut,line,bar}-chart 抽出，供组件与分享卡片共用。
//
// 为什么抽出来：统计页分享图要求 1:1 复刻页面布局，如果分享图另写一套绘制，
// 两边迟早会漂移。共用同一份算法是唯一能长期保证一致的做法。
//
// 约定：所有函数只接收 ctx 与尺寸/数据，不调用任何 wx.* API，
// 因此既能在组件里用 canvas 节点，也能在页面离屏画布上用，还可在 node 里用假 ctx 单测。
import { CHART_THEME, drawBubble } from './chart-draw';
import { layoutDonutLabels } from './chart-math';
import { MAX_FUEL_CONSUMPTION } from '../domain/fuel.service';

export const LABEL_FONT = '10px sans-serif';
export const LABEL_LINE_HEIGHT = 14;

// ---------------- 环形图 ----------------

export interface DonutSegment {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

export interface DonutRenderOptions {
  ctx: any;
  w: number;
  h: number;
  segments: DonutSegment[];
  total: string;
  /** 选中扇区索引，-1 表示无选中 */
  activeIndex?: number;
}

/** 绘制环形图（与 donut-chart 组件完全同一算法） */
export function renderDonut(opts: DonutRenderOptions): void {
  const { ctx, w, h, segments, total } = opts;
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;

  if (!segments.length) return;

  const cx = w / 2;
  const cy = h / 2;
  const labelSpace = Math.max(70, w * 0.26);
  const outerR = Math.min(w / 2 - labelSpace, h / 2 - 14);
  if (outerR < 20) return;
  const innerR = outerR * 0.55;
  const offR = 10;

  // 扇区
  let start = -Math.PI / 2;
  segments.forEach((seg, i) => {
    const angle = (seg.percent / 100) * Math.PI * 2;
    const mid = start + angle / 2;
    const isActive = i === active;
    const ox = isActive ? Math.cos(mid) * offR : 0;
    const oy = isActive ? Math.sin(mid) * offR : 0;

    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, outerR, start, start + angle);
    ctx.arc(cx + ox, cy + oy, innerR, start + angle, start, true);
    ctx.closePath();
    ctx.globalAlpha = active >= 0 && !isActive ? 0.28 : 1;
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (isActive) {
      ctx.strokeStyle = CHART_THEME.card;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    start += angle;
  });

  // 中心金额
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CHART_THEME.text1;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(`¥${total}`, cx, cy - 7);
  ctx.fillStyle = CHART_THEME.text3;
  ctx.font = '10px sans-serif';
  ctx.fillText('总支出', cx, cy + 13);

  // 外标签（防重叠）
  start = -Math.PI / 2;
  const mids: number[] = [];
  segments.forEach(seg => {
    const angle = (seg.percent / 100) * Math.PI * 2;
    mids.push(start + angle / 2);
    start += angle;
  });
  const labels = layoutDonutLabels({
    segments: segments.map((seg, i) => ({ mid: mids[i], percent: seg.percent })),
    cx,
    cy,
    outerR,
    minY: LABEL_LINE_HEIGHT / 2 + 2,
    maxY: h - LABEL_LINE_HEIGHT / 2 - 2,
    minGap: LABEL_LINE_HEIGHT,
    elbowGap: 13,
    tailGap: 4
  });

  ctx.font = LABEL_FONT;
  ctx.textBaseline = 'middle';
  segments.forEach((seg, i) => {
    const lay = labels[i];
    ctx.beginPath();
    ctx.moveTo(lay.anchorX, lay.anchorY);
    ctx.lineTo(lay.elbowX, lay.elbowY);
    ctx.lineTo(lay.x, lay.elbowY);
    ctx.strokeStyle = seg.color;
    ctx.lineWidth = 1;
    ctx.stroke();

    const label = `${seg.name} ${seg.percent.toFixed(2)}%`;
    ctx.fillStyle = CHART_THEME.label;
    ctx.textAlign = lay.side === 'right' ? 'left' : 'right';
    ctx.fillText(label, lay.x, lay.y);
  });

  // 选中气泡
  if (active >= 0 && active < segments.length) {
    const seg = segments[active];
    let s = -Math.PI / 2;
    for (let i = 0; i < active; i++) s += (segments[i].percent / 100) * Math.PI * 2;
    const a = (seg.percent / 100) * Math.PI * 2;
    const mid = s + a / 2;
    const ox = Math.cos(mid) * offR;
    const oy = Math.sin(mid) * offR;
    const r = (outerR + innerR) / 2;
    drawBubble(ctx, {
      text: `${seg.name}：¥${seg.amount}（${seg.percent.toFixed(2)}%）`,
      x: cx + ox + Math.cos(mid) * r,
      y: cy + oy + Math.sin(mid) * r,
      w,
      h
    });
  }
}

// ---------------- 折线图 ----------------

export interface LinePoint {
  label: string;
  value: number;
}

export interface LineRenderOptions {
  ctx: any;
  w: number;
  h: number;
  points: LinePoint[];
  /** Y 轴基准上限 */
  yMax?: number;
  activeIndex?: number;
}

/** 绘制折线图（与 line-chart 组件完全同一算法） */
export function renderLine(opts: LineRenderOptions): void {
  const { ctx, w, h, points: pts } = opts;
  if (!pts.length) return;

  const maxValue = Math.max(...pts.map(p => p.value));
  const baseYMax = opts.yMax || 15;
  const yMax = Math.min(MAX_FUEL_CONSUMPTION, Math.max(baseYMax, Math.ceil(maxValue / 5) * 5));

  const padL = 28;
  const padR = 12;
  const padT = 24;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const x = (i: number) => (pts.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (pts.length - 1));
  const y = (v: number) => {
    const clamped = Math.max(0, Math.min(Number(v) || 0, yMax));
    return padT + plotH * (1 - clamped / yMax);
  };

  // 网格线
  ctx.strokeStyle = CHART_THEME.grid;
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(ratio => {
    const gy = padT + plotH * ratio;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w - padR, gy);
    ctx.stroke();
  });

  // 折线
  if (pts.length > 1) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(x(i), y(p.value));
      else ctx.lineTo(x(i), y(p.value));
    });
    ctx.strokeStyle = CHART_THEME.primary;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 数据点 + 数值
  const spacing = plotW / Math.max(1, pts.length - 1);
  const dense = spacing < 36;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';

  pts.forEach((p, i) => {
    const px = x(i);
    const py = y(p.value);

    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = CHART_THEME.primary;
    ctx.fill();

    let ty = py - 9;
    if (ty < padT + 9) ty = py + 17;
    else if (dense && i % 2 === 1) ty = py + 17;
    if (ty > h - padB - 2) ty = py - 9;

    ctx.fillStyle = CHART_THEME.primary;
    ctx.fillText(p.value.toFixed(2), px, ty);
  });

  // X 轴标签（最多 6 个）
  ctx.fillStyle = CHART_THEME.text3;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  const step = Math.ceil(pts.length / 6);
  pts.forEach((p, i) => {
    if (i % step !== 0 && i !== pts.length - 1) return;
    ctx.fillText(p.label, x(i), h - 6);
  });

  // 选中高亮
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;
  if (active >= 0 && active < pts.length) {
    const p = pts[active];
    const px = x(active);
    const py = y(p.value);
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.strokeStyle = CHART_THEME.primary;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = CHART_THEME.card;
    ctx.fill();
  }
}

// ---------------- 柱状图 ----------------

export interface BarItem {
  label: string;
  value: number;
}

export interface BarRenderOptions {
  ctx: any;
  w: number;
  h: number;
  bars: BarItem[];
  activeIndex?: number;
}

/** 绘制柱状图（与 bar-chart 组件完全同一算法） */
export function renderBars(opts: BarRenderOptions): void {
  const { ctx, w, h, bars } = opts;
  if (!bars.length) return;

  const maxVal = Math.max(...bars.map(b => b.value));
  if (maxVal <= 0) return;

  const padL = 8;
  const padR = 8;
  const padT = 18;
  const padB = 24;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const slot = plotW / bars.length;
  const barW = slot * 0.5;
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;

  bars.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const bh = (b.value / maxVal) * plotH;
    const x = cx - barW / 2;
    const y = padT + plotH - bh;
    const isActive = i === active;

    ctx.fillStyle = isActive ? CHART_THEME.primaryDark : CHART_THEME.primary;
    const r = Math.min(4, barW / 2);
    ctx.beginPath();
    ctx.moveTo(x, padT + plotH);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + barW - r, y);
    ctx.arcTo(x + barW, y, x + barW, y + r, r);
    ctx.lineTo(x + barW, padT + plotH);
    ctx.closePath();
    ctx.fill();
    if (isActive) {
      ctx.strokeStyle = CHART_THEME.card;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = isActive ? CHART_THEME.primaryDark : CHART_THEME.text3;
    ctx.font = isActive ? 'bold 10px sans-serif' : '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(b.value)), cx, y - 4);

    ctx.fillText(b.label, cx, h - 6);
  });

  if (active >= 0 && active < bars.length) {
    const b = bars[active];
    const cx = padL + slot * active + slot / 2;
    const y = padT + plotH - (b.value / maxVal) * plotH;
    drawBubble(ctx, {
      text: `${b.label} · ${Math.round(b.value)}`,
      x: cx,
      y: y - 20,
      w,
      h
    });
  }
}
