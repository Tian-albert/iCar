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

export interface DonutLabelInput {
  /** 扇区中点角度（弧度，0 = 3 点方向，-π/2 = 12 点方向） */
  mid: number;
  percent: number;
}

export interface DonutLabelLayout {
  side: 'left' | 'right';
  /** 引线起点（扇区外缘） */
  anchorX: number;
  anchorY: number;
  /** 引线折点 */
  elbowX: number;
  elbowY: number;
  /** 文字落点 */
  x: number;
  y: number;
}

export interface DonutLabelOptions {
  segments: DonutLabelInput[];
  cx: number;
  cy: number;
  outerR: number;
  minY: number;
  maxY: number;
  /** 同侧相邻标签的最小垂直间距 */
  minGap: number;
  /** 引线折点相对外缘的径向偏移 */
  elbowGap: number;
  /** 文字相对折点的水平偏移 */
  tailGap: number;
}

/**
 * 环形图外标签布局（含防重叠）。
 *
 * 问题：小占比扇区角度接近时，标签的原始 y 几乎相同，直接绘制会互相遮挡。
 * 做法：左右分侧 → 每侧按 y 升序 → 自上而下推开保证 minGap →
 * 若被推到底部边界外，再自下而上回压 → 折点 y 跟随标签 y，引线不会交叉。
 */
export function layoutDonutLabels(opts: DonutLabelOptions): DonutLabelLayout[] {
  const { segments, cx, cy, outerR, minY, maxY, minGap, elbowGap, tailGap } = opts;

  const items = segments.map((seg, index) => {
    const cos = Math.cos(seg.mid);
    const sin = Math.sin(seg.mid);
    const side: 'left' | 'right' = cos >= 0 ? 'right' : 'left';
    const anchorR = outerR + 2;
    const elbowR = outerR + elbowGap;
    const y = clamp(cy + sin * elbowR, minY, maxY);
    return {
      index,
      side,
      anchorX: cx + cos * anchorR,
      anchorY: cy + sin * anchorR,
      elbowX: cx + cos * elbowR,
      y,
      origY: y
    };
  });

  for (const side of ['left', 'right'] as const) {
    const group = items.filter(i => i.side === side).sort((a, b) => a.y - b.y);
    if (group.length === 0) continue;

    // 1) 自上而下推开
    for (let i = 1; i < group.length; i++) {
      const need = group[i - 1].y + minGap;
      if (group[i].y < need) group[i].y = need;
    }
    // 2) 若末位越界，自下而上回压
    const overflow = group[group.length - 1].y - maxY;
    if (overflow > 0) {
      group[group.length - 1].y = maxY;
      for (let i = group.length - 2; i >= 0; i--) {
        const need = group[i + 1].y - minGap;
        group[i].y = Math.min(group[i].y, need);
      }
      // 3) 极端情况下（标签数过多）再自上而下兜一次底
      for (let i = 1; i < group.length; i++) {
        const need = group[i - 1].y + minGap;
        if (group[i].y < need) group[i].y = need;
      }
    }
  }

  const out: DonutLabelLayout[] = new Array(segments.length);
  for (const it of items) {
    const dir = it.side === 'right' ? 1 : -1;
    out[it.index] = {
      side: it.side,
      anchorX: it.anchorX,
      anchorY: it.anchorY,
      elbowX: it.elbowX,
      elbowY: it.y,
      x: it.elbowX + dir * tailGap,
      y: it.y
    };
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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
