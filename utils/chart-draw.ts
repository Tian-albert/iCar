// 图表气泡绘制（R-06）：三个组件共用，避免重复的圆角矩形与气泡代码
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

  ctx.fillStyle = 'rgba(15,23,42,0.10)';
  roundRect(ctx, bx + 1, by + 2, bw, bh, 8);
  ctx.fill();

  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#E6EAF1';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#1F2430';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = opts.font || 'bold 11px sans-serif';
  ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
}
