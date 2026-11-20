// 图表纯绘制函数：从 components/{donut,line,bar}-chart 抽出，供组件与分享卡片共用。
//
// 为什么抽出来：统计页分享图要求 1:1 复刻页面布局，如果分享图另写一套绘制，
// 两边迟早会漂移。共用同一份算法是唯一能长期保证一致的做法。
//
// 约定：所有函数只接收 ctx 与尺寸/数据，不调用任何 wx.* API，
// 因此既能在组件里用 canvas 节点，也能在页面离屏画布上用，还可在 node 里用假 ctx 单测。
import { CHART_THEME as BASE_THEME, ChartTheme, drawBubble } from './chart-draw';
import { layoutDonutLabels } from './chart-math';
import { maxOf } from './number';
import { MAX_FUEL_CONSUMPTION } from '../domain/fuel.service';

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
export function computeDonutLayout(
  w: number,
  h: number,
  fontScale = 1,
  withLabels = true
): DonutLayout {
  const scale = fontScale > 0 ? fontScale : 1;
  const cx = w / 2;
  const cy = h / 2;
  // 无外标签时不必为标签预留横向空间，环可以画得更大
  const labelSpace = withLabels ? Math.max(70 * scale, w * 0.26) : 0;
  const padX = withLabels ? 0 : 4;
  const padY = withLabels ? 14 * scale : 4;
  const outerR = Math.min(w / 2 - labelSpace - padX, h / 2 - padY);
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

  // 用 maxOf 而不是 Math.max(...)：记录上万条时展开会栈溢出，
  // 且只要有一个 NaN 就会让 yMax 变 NaN，整条折线静默消失
  const maxValue = maxOf(points.map(p => p.value));
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
  const maxVal = maxOf(bars.map(b => b.value));
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
  /**
   * 是否绘制外标签引线与文字，默认 true。
   * 概览页那种 100px 左右的小环图设 false，否则标签会挤成一团。
   */
  showLabels?: boolean;
  /** 中心下方的小字，默认「总支出」；传空字符串表示不画 */
  centerLabel?: string;
  /**
   * 中心主文字是否加 ¥ 前缀，默认 true。
   * 概览的保养环图中心是「1 / 6」这种计数，加 ¥ 就成了「¥1 / 6」。
   */
  withCurrency?: boolean;
  /**
   * 外标签文字的自定义格式化。
   *
   * 默认是「名称 55.30%」。概览页环图只有 100 多像素高，
   * 两位小数太长，改传「名称 55%」能少占宽度、也更好读。
   */
  labelFormatter?: (seg: DonutSegment, index: number) => string;
  /**
   * 颜色覆盖：深色主题的分享卡需要浅色文字与更淡的网格，
   * 但 Canvas 不读 CSS 变量，只能由调用方注入。
   */
  ink?: Partial<ChartTheme>;
}

/** 绘制环形图（与 donut-chart 组件完全同一算法） */
export function renderDonut(opts: DonutRenderOptions): void {
  // 局部覆盖：下面的 CHART_THEME.xxx 自动取注入后的值，未传的字段回落到全局主题
  const CHART_THEME: ChartTheme = { ...BASE_THEME, ...(opts.ink || {}) };
  const { ctx, w, h, segments, total } = opts;
  const active = typeof opts.activeIndex === 'number' ? opts.activeIndex : -1;
  const scale = opts.fontScale && opts.fontScale > 0 ? opts.fontScale : 1;
  const lineH = LABEL_LINE_HEIGHT * scale;
  const showLabels = opts.showLabels !== false;

  if (!segments.length) return;

  const layout = computeDonutLayout(w, h, scale, showLabels);
  if (!layout.valid) return;
  const { cx, cy, outerR, innerR, offR } = layout;

  /**
   * 角度按「实际合计」归一，而不是按固定的 100。
   *
   * 数据源的百分比可能合计 99.9 或 100.1（概览页只保留 1 位小数、不做补差），
   * 用 `percent / 100` 画会在首尾留下一道可见缝隙；
   * 而触摸命中判定（chart-math 的 hitDonutSegment）本来就是按合计归一的，
   * 两边口径不一致还会导致「点得到的位置」和「画出来的位置」错位。
   */
  const pctTotal = segments.reduce((sum, seg) => sum + Math.max(0, seg.percent), 0) || 1;

  // 扇区
  let start = -Math.PI / 2;
  segments.forEach((seg, i) => {
    const angle = (seg.percent / pctTotal) * Math.PI * 2;
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
  const centerValue = opts.withCurrency === false ? total : `¥${total}`;
  // centerLabel 未传时用默认文案；显式传 '' 表示「只留数字」，不再补一行小字
  const centerLabel = opts.centerLabel === undefined ? '总支出' : opts.centerLabel;
  // 只有数字时整体上移一点，视觉才居中
  ctx.fillText(centerValue, cx, centerLabel ? cy - 7 * scale : cy);
  if (centerLabel) {
    ctx.fillStyle = CHART_THEME.text3;
    ctx.font = fontOf(10, scale);
    ctx.fillText(centerLabel, cx, cy + 13 * scale);
  }

  if (showLabels) {
  // 外标签（防重叠）
  start = -Math.PI / 2;
  const mids: number[] = [];
  segments.forEach(seg => {
    const angle = (seg.percent / pctTotal) * Math.PI * 2;
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

    const label = opts.labelFormatter
      ? opts.labelFormatter(seg, i)
      : `${seg.name} ${seg.percent.toFixed(2)}%`;
    ctx.fillStyle = CHART_THEME.label;
    ctx.textAlign = lay.side === 'right' ? 'left' : 'right';
    ctx.fillText(label, lay.x, lay.y);
  });
  }

  // 选中气泡
  if (active >= 0 && active < segments.length) {
    const seg = segments[active];
    let s = -Math.PI / 2;
    for (let i = 0; i < active; i++) s += (segments[i].percent / pctTotal) * Math.PI * 2;
    const a = (seg.percent / pctTotal) * Math.PI * 2;
    const mid = s + a / 2;
    const ox = Math.cos(mid) * offR;
    const oy = Math.sin(mid) * offR;
    const r = (outerR + innerR) / 2;
    drawBubble(ctx, {
      text: `${seg.name}：¥${seg.amount}（${seg.percent.toFixed(2)}%）`,
      x: cx + ox + Math.cos(mid) * r,
      y: cy + oy + Math.sin(mid) * r,
      w,
      h,
      scale
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
  /** 颜色覆盖：深色主题的分享卡需要更淡的网格与更亮的折线 */
  ink?: Partial<ChartTheme>;
}

/** 绘制折线图（与 line-chart 组件完全同一算法） */
export function renderLine(opts: LineRenderOptions): void {
  const CHART_THEME: ChartTheme = { ...BASE_THEME, ...(opts.ink || {}) };
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
    // 脏数据（NaN/undefined）不该让整个 draw() 抛错中断，显示占位符即可
    ctx.fillText(Number.isFinite(p.value) ? p.value.toFixed(2) : '--', px, ty);
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
  /** 颜色覆盖：深色主题的分享卡需要更淡的网格与更亮的柱子 */
  ink?: Partial<ChartTheme>;
}

/** 绘制柱状图（与 bar-chart 组件完全同一算法） */
export function renderBars(opts: BarRenderOptions): void {
  const CHART_THEME: ChartTheme = { ...BASE_THEME, ...(opts.ink || {}) };
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
    ctx.fillText(Number.isFinite(b.value) ? String(Math.round(b.value)) : '--', cx, y - 4 * scale);

    ctx.fillText(b.label, cx, h - 6 * scale);
  });

  if (active >= 0 && active < bars.length) {
    const b = bars[active];
    const cx = padL + slot * active + slot / 2;
    const y = padT + plotH - (b.value / maxVal) * plotH;
    drawBubble(ctx, {
      text: `${b.label} · ${Number.isFinite(b.value) ? Math.round(b.value) : '--'}`,
      x: cx,
      y: y - 20 * scale,
      w,
      h,
      scale
    });
  }
}
