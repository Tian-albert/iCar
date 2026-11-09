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

/**
 * 字号缩放。
 *
 * 页面组件宽度约 335px（750rpx 屏宽减 padding），字号 10px 是相对它调的；
 * 分享卡片逻辑宽度 750px（2 倍设计稿），若沿用 10px 会显得极小、看不清。
 * 因此绘制函数接受 fontScale，卡片侧传 2 左右，组件侧保持 1。
 */
function fs(base: number, scale: number): number {
  return Math.round(base * scale);
}

function fontOf(size: number, scale: number, weight = 'normal'): string {
  return `${weight} ${fs(size, scale)}px sans-serif`;
}

// ---------------- 布局计算（组件触摸命中与绘制共用，避免两份公式漂移）----------------

export interface DonutLayout {
  cx: number;
  cy: number;
  outerR: number;
  innerR: number;
  /** 选中扇区外移距离 */
  offR: number;
  /** 有效：outerR 足够大 */
  valid: boolean;
}

/**
 * 环形图几何布局。
 * 组件用它做触摸命中判定，绘制函数用它画图——同一份公式，改一处两边同步。
 */
export function computeDonutLayout(w: number, h: number, fontScale = 1): DonutLayout {
  const scale = fontScale > 0 ? fontScale : 1;
  const cx = w / 2;
  const cy = h / 2;
  const labelSpace = Math.max(70 * scale, w * 0.26);
  const outerR = Math.min(w / 2 - labelSpace, h / 2 - 14 * scale);
  const innerR = outerR * 0.55;
  const offR = 10 * scale;
  return { cx, cy, outerR, innerR, offR, valid: outerR >= 20 };
}

export interface LineLayout {
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  /** 实际使用的 Y 轴上限 */
  yMax: number;
}

/**
 * 折线图几何布局。
 * yMax 依赖数据与封顶值，组件必须用同一结果做命中判定，否则点击会错位。
 */
export function computeLineLayout(
  w: number,
  h: number,
  points: Array<{ value: number }>,
  opts: { yMax?: number; ceiling?: number; fontScale?: number } = {}
): LineLayout {
  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const padL = 28 * scale;
  const padR = 12 * scale;
  const padT = 24 * scale;
  const padB = 24 * scale;

  const maxValue = points.length ? Math.max(...points.map(p => p.value)) : 0;
  const baseYMax = opts.yMax || 15;
  const ceiling = opts.ceiling && opts.ceiling > 0 ? opts.ceiling : MAX_FUEL_CONSUMPTION;
  const yMax = Math.min(ceiling, Math.max(baseYMax, Math.ceil(maxValue / 5) * 5));

  return { padL, padR, padT, padB, plotW: w - padL - padR, plotH: h - padT - padB, yMax };
}

export interface BarLayout {
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  plotW: number;
  plotH: number;
  /** 每根柱子占的槽宽 */
  slot: number;
  barW: number;
  /** 最大值，<=0 表示无可绘制数据 */
  maxVal: number;
}

/** 柱状图几何布局 */
export function computeBarLayout(
  w: number,
  h: number,
  bars: Array<{ value: number }>,
  fontScale = 1
): BarLayout {
  const scale = fontScale > 0 ? fontScale : 1;
  const padL = 8 * scale;
  const padR = 8 * scale;
  const padT = 18 * scale;
  const padB = 24 * scale;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = bars.length ? Math.max(...bars.map(b => b.value)) : 0;
  const slot = bars.length ? plotW / bars.length : 0;
  const barW = slot * 0.5;
  return { padL, padR, padT, padB, plotW, plotH, slot, barW, maxVal };
}

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
  /** 字号缩放，默认 1（页面组件）；分享卡片传约 2 */
  fontScale?: number;
}

/** 绘制环形图（与 donut-chart 组件完全同一算法） */
export function renderDonut(opts: DonutRenderOptions): void {
  const { ctx, w, h, segments, total } = opts;
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;
  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const lineH = LABEL_LINE_HEIGHT * scale;

  if (!segments.length) return;

  const layout = computeDonutLayout(w, h, scale);
  if (!layout.valid) return;
  const { cx, cy, outerR, innerR, offR } = layout;

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
  ctx.font = fontOf(14, scale, 'bold');
  ctx.fillText(`¥${total}`, cx, cy - 7 * scale);
  ctx.fillStyle = CHART_THEME.text3;
  ctx.font = fontOf(10, scale);
  ctx.fillText('总支出', cx, cy + 13 * scale);

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
    minY: lineH / 2 + 2,
    maxY: h - lineH / 2 - 2,
    minGap: lineH,
    elbowGap: 13 * scale,
    tailGap: 4 * scale
  });

  ctx.font = fontOf(10, scale);
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
  /** 字号缩放，默认 1（页面组件）；分享卡片传约 2 */
  fontScale?: number;
  /**
   * Y 轴封顶值：油耗 30，电耗 50。
   * 纯电车电耗可达 33+，若沿用油耗上限 30，数据点会被压到图顶而标签仍显示真值。
   */
  ceiling?: number;
}

/** 绘制折线图（与 line-chart 组件完全同一算法） */
export function renderLine(opts: LineRenderOptions): void {
  const { ctx, w, h, points: pts } = opts;
  if (!pts.length) return;

  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;

  // 与组件触摸命中共用同一份布局公式
  const layout = computeLineLayout(w, h, pts, {
    yMax: opts.yMax,
    ceiling: opts.ceiling,
    fontScale: scale
  });
  const { padL, padR, padT, padB, plotW, plotH, yMax } = layout;

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
  const dense = spacing < 36 * scale;
  ctx.font = fontOf(10, scale);
  ctx.textAlign = 'center';

  pts.forEach((p, i) => {
    const px = x(i);
    const py = y(p.value);

    ctx.beginPath();
    ctx.arc(px, py, 3 * scale, 0, Math.PI * 2);
    ctx.fillStyle = CHART_THEME.primary;
    ctx.fill();

    let ty = py - 9 * scale;
    if (ty < padT + 9 * scale) ty = py + 17 * scale;
    else if (dense && i % 2 === 1) ty = py + 17 * scale;
    if (ty > h - padB - 2) ty = py - 9 * scale;

    ctx.fillStyle = CHART_THEME.primary;
    ctx.fillText(p.value.toFixed(2), px, ty);
  });

  // X 轴标签（最多 6 个）
  ctx.fillStyle = CHART_THEME.text3;
  ctx.font = fontOf(10, scale);
  ctx.textAlign = 'center';
  const step = Math.ceil(pts.length / 6);
  pts.forEach((p, i) => {
    if (i % step !== 0 && i !== pts.length - 1) return;
    ctx.fillText(p.label, x(i), h - 6 * scale);
  });

  // 选中高亮
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;
  if (active >= 0 && active < pts.length) {
    const p = pts[active];
    const px = x(active);
    const py = y(p.value);
    ctx.beginPath();
    ctx.arc(px, py, 7 * scale, 0, Math.PI * 2);
    ctx.strokeStyle = CHART_THEME.primary;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, 3 * scale, 0, Math.PI * 2);
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
  /** 字号缩放，默认 1（页面组件）；分享卡片传约 2 */
  fontScale?: number;
}

/** 绘制柱状图（与 bar-chart 组件完全同一算法） */
export function renderBars(opts: BarRenderOptions): void {
  const { ctx, w, h, bars } = opts;
  if (!bars.length) return;

  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;

  // 与组件触摸命中共用同一份布局公式
  const layout = computeBarLayout(w, h, bars, scale);
  if (layout.maxVal <= 0) return;
  const { padL, padT, plotH, slot, barW, maxVal } = layout;
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
    ctx.font = fontOf(10, scale, isActive ? 'bold' : 'normal');
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(b.value)), cx, y - 4 * scale);

    ctx.fillText(b.label, cx, h - 6 * scale);
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
