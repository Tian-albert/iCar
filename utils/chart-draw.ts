// 图表配色与气泡绘制（T-05 / R-06）
// Canvas 2D 上下文不解析 CSS 变量，因此把 app.wxss 的令牌在此镜像一份。
// 改动任一处颜色时必须同步另一处；tests/chart-theme.test.ts 会校验一致性。
export interface ChartTheme {
  primary: string;
  primaryDark: string;
  card: string;
  text1: string;
  text3: string;
  label: string;
  grid: string;
  border: string;
  shadow: string;
}

/** 不使用 as const：开发者工具内置 TS 编译插件版本较旧，可能无法产出该模块的 js */
export const CHART_THEME: ChartTheme = {
  /** --color-primary */
  primary: '#3B6FF6',
  /** --color-primary-dark */
  primaryDark: '#1D4ED8',
  /** --color-card */
  card: '#FFFFFF',
  /** --color-text-1 */
  text1: '#1F2430',
  /** --color-text-3 */
  text3: '#9AA4B2',
  /** 外标签专用色（--color-text-2 的图表变体） */
  label: '#4A5363',
  /** --chart-grid */
  grid: '#EEF0F3',
  /** --color-border */
  border: '#E6EAF1',
  /** 气泡阴影，允许保持 rgba 字面量 */
  shadow: 'rgba(15,23,42,0.10)'
};

export interface BubbleOptions {
  text: string;
  x: number; // 期望的气泡中心 x
  y: number; // 期望的气泡中心 y
  w: number; // 画布宽
  h: number; // 画布高
  font?: string;
}

export function roundRect(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 在 (x, y) 附近画一个白底气泡，自动钳制在画布内不越界 */
export function drawBubble(ctx: any, opts: BubbleOptions): void {
  const { text, x, y, w, h } = opts;
  ctx.font = opts.font || 'bold 11px sans-serif';
  const tw = ctx.measureText(text).width;
  const bw = tw + 24;
  const bh = 28;
  const bx = Math.max(3, Math.min(w - bw - 3, x - bw / 2));
  const by = Math.max(3, Math.min(h - bh - 3, y - bh / 2));

  ctx.fillStyle = CHART_THEME.shadow;
  roundRect(ctx, bx + 1, by + 2, bw, bh, 8);
  ctx.fill();

  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = CHART_THEME.card;
  ctx.fill();
  ctx.strokeStyle = CHART_THEME.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = CHART_THEME.text1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font || 'bold 11px sans-serif';
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
}
