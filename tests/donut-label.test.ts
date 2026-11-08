// 环形图外标签避让单测：小扇区相邻时标签不得重叠
import { layoutDonutLabels, DonutLabelInput } from '../utils/chart-math';

const CX = 150;
const CY = 200;
const OUTER_R = 100;
const MIN_Y = 12;
const MAX_Y = 388; // h - 12

function layout(segs: DonutLabelInput[], minGap = 14) {
  return layoutDonutLabels({
    segments: segs,
    cx: CX,
    cy: CY,
    outerR: OUTER_R,
    minY: MIN_Y,
    maxY: MAX_Y,
    minGap,
    elbowGap: 13,
    tailGap: 4
  });
}

/** 生成以 mid 为中心的扇区（percent 只影响 mid，不参与避让计算） */
function at(mid: number, percent = 10): DonutLabelInput {
  return { mid, percent };
}

describe('layoutDonutLabels 左右分侧', () => {
  it('cos(mid) >= 0 归右侧，否则归左侧', () => {
    const out = layout([at(0), at(Math.PI)]);
    expect(out[0].side).toBe('right');
    expect(out[1].side).toBe('left');
  });

  it('右侧标签文字左对齐、左侧右对齐（x 对称）', () => {
    const out = layout([at(0), at(Math.PI)]);
    const right = out[0];
    const left = out[1];
    expect(right.x).toBeGreaterThan(CX);
    expect(left.x).toBeLessThan(CX);
    // 与圆心距离相等
    expect(right.x - CX).toBeCloseTo(CX - left.x, 5);
  });
});

describe('layoutDonutLabels 防重叠', () => {
  it('不重叠时保持原始 y（仅受边界钳制）', () => {
    // 顶部与底部各一个，天然分开
    const out = layout([at(-Math.PI / 2), at(Math.PI / 2)]);
    const ys = out.map(o => o.y);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(14);
  });

  it('相邻小扇区的标签被推开，同侧任意两个间距 >= minGap', () => {
    // 三个几乎同角度的扇区（模拟小占比相邻）
    const segs = [at(-0.62), at(-0.6), at(-0.58)];
    const out = layout(segs, 14);
    const ys = out.map(o => o.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(13.999);
    }
  });

  it('两侧互不干扰：同侧才需要满足间距', () => {
    // 关于竖直轴对称的两个角度（一个右上、一个左上），y 应相同
    const out = layout([at(-0.5), at(-Math.PI + 0.5)], 14);
    expect(out[0].side).toBe('right');
    expect(out[1].side).toBe('left');
    expect(Math.abs(out[0].y - out[1].y)).toBeLessThan(0.001);
  });

  it('标签不会越出上下边界', () => {
    // 全部挤在正下方，必然被推到 maxY 以内
    const segs = [at(1.5), at(1.52), at(1.54), at(1.56)];
    const out = layout(segs, 14);
    for (const o of out) {
      expect(o.y).toBeGreaterThanOrEqual(MIN_Y);
      expect(o.y).toBeLessThanOrEqual(MAX_Y);
    }
  });

  it('大量扇区也能全部落在边界内且同侧不重叠', () => {
    const segs: DonutLabelInput[] = [];
    for (let i = 0; i < 12; i++) segs.push(at(-Math.PI / 2 + (i * Math.PI * 2) / 12, 8));
    const out = layout(segs, 12);
    expect(out.length).toBe(12);

    const bySide: Record<string, number[]> = { left: [], right: [] };
    for (const o of out) bySide[o.side].push(o.y);
    for (const side of ['left', 'right']) {
      const ys = bySide[side].sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(11.999);
      }
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(MIN_Y);
        expect(y).toBeLessThanOrEqual(MAX_Y);
      }
    }
  });
});

describe('layoutDonutLabels 引线几何', () => {
  it('引线起点在扇区外缘，折点在起点外侧', () => {
    const out = layout([at(0)]);
    const o = out[0];
    expect(o.anchorX - CX).toBeCloseTo(OUTER_R + 2, 5);
    expect(o.elbowX).toBeGreaterThan(o.anchorX);
    expect(o.x).toBeGreaterThan(o.elbowX);
  });

  it('标签被下推时，折点 y 跟随标签 y（引线不交叉）', () => {
    const segs = [at(-0.62), at(-0.6), at(-0.58)];
    const out = layout(segs, 14);
    for (const o of out) {
      expect(o.elbowY).toBe(o.y);
    }
  });
});
