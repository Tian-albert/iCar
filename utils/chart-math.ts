// 图表触摸命中计算（R-06）：纯函数，不依赖 wx / canvas，可单测
export interface CanvasRect {
  left: number;
  top: number;
}

export interface TouchLike {
  x?: number;
  y?: number;
  clientX?: number;
  clientY?: number;
}

/** 触摸点 → canvas 内坐标：优先用 x/y，缺失时按视口坐标减去画布偏移 */
export function toCanvasPoint(
  touch: TouchLike,
  rect: CanvasRect
): { x: number; y: number } | null {
  if (typeof touch.x === 'number' && typeof touch.y === 'number') {
    return { x: touch.x, y: touch.y };
  }
  if (typeof touch.clientX === 'number' && typeof touch.clientY === 'number') {
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  return null;
}

/** 折线第 i 个点的 x；单点时居中，避免除零 */
export function linePointX(i: number, count: number, padL: number, plotW: number): number {
  return count === 1 ? padL + plotW / 2 : padL + (plotW * i) / (count - 1);
}

/** 命中最近折线点；超出容差返回 -1 */
export function hitLineIndex(
  x: number,
  count: number,
  padL: number,
  plotW: number,
  tolerance?: number
): number {
  if (count <= 0) return -1;
  const spacing = count > 1 ? plotW / (count - 1) : plotW;
  const tol = tolerance ?? Math.max(16, Math.min(spacing / 2, 40));
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < count; i++) {
    const d = Math.abs(x - linePointX(i, count, padL, plotW));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return bestDist <= tol ? best : -1;
}

/** 命中柱状图的槽位；越界返回 -1 */
export function hitBarIndex(x: number, count: number, padL: number, plotW: number): number {
  if (count <= 0) return -1;
  const slot = plotW / count;
  const idx = Math.floor((x - padL) / slot);
  return idx >= 0 && idx < count ? idx : -1;
}

/**
 * 环形扇区命中。
 * 关键：选中的扇区会向外凸出 offset 像素，必须用「该扇区自己的圆心」判定，
 * 否则再次点击该扇区会落空（R-06 修复点）。
 */
export function hitDonutSegment(
  x: number,
  y: number,
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  percents: number[],
  activeIndex: number,
  offset: number,
  tolerance = 6
): number {
  if (!percents.length) return -1;
  const total = percents.reduce((s, p) => s + Math.max(0, p), 0);
  if (total <= 0) return -1;

  const TAU = Math.PI * 2;
  let startAngle = -Math.PI / 2;
  let normalizedStart = 0;

  for (let i = 0; i < percents.length; i++) {
    const angle = (Math.max(0, percents[i]) / total) * TAU;
    const mid = startAngle + angle / 2;
    const ox = i === activeIndex ? Math.cos(mid) * offset : 0;
    const oy = i === activeIndex ? Math.sin(mid) * offset : 0;
    const dx = x - (cx + ox);
    const dy = y - (cy + oy);
    const r = Math.sqrt(dx * dx + dy * dy);

    if (r >= innerR - tolerance && r <= outerR + tolerance) {
      let ang = Math.atan2(dy, dx) + Math.PI / 2;
      if (ang < 0) ang += TAU;
      ang %= TAU;
      if (ang >= normalizedStart && ang < normalizedStart + angle) return i;
    }
    startAngle += angle;
    normalizedStart += angle;
  }
  return -1;
}
