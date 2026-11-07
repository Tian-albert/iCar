// 图表触摸命中的纯函数单测（R-06）：组件只负责取坐标与绘制，判定逻辑在此验证
import {
  linePointX,
  hitLineIndex,
  hitBarIndex,
  hitDonutSegment,
  toCanvasPoint
} from '../utils/chart-math';

describe('chart-math 折线命中', () => {
  it('单点居中，等距点阵按索引线性分布', () => {
    expect(linePointX(0, 1, 28, 200)).toBe(128);
    expect(linePointX(0, 3, 28, 200)).toBe(28);
    expect(linePointX(1, 3, 28, 200)).toBe(128);
    expect(linePointX(2, 3, 28, 200)).toBe(228);
  });

  it('点附近命中最近点，远离画布区域不命中', () => {
    expect(hitLineIndex(128, 3, 28, 200, 20)).toBe(1);
    expect(hitLineIndex(30, 3, 28, 200, 20)).toBe(0);
    expect(hitLineIndex(-50, 3, 28, 200, 20)).toBe(-1);
  });

  it('无数据时返回 -1', () => {
    expect(hitLineIndex(100, 0, 28, 200, 20)).toBe(-1);
  });
});

describe('chart-math 柱状命中', () => {
  it('按槽位命中，越界返回 -1', () => {
    // 4 根柱，plotW=200 时每槽 50
    expect(hitBarIndex(8 + 25, 4, 8, 200)).toBe(0);
    expect(hitBarIndex(8 + 75, 4, 8, 200)).toBe(1);
    expect(hitBarIndex(8 + 199, 4, 8, 200)).toBe(3);
    expect(hitBarIndex(2, 4, 8, 200)).toBe(-1);
    expect(hitBarIndex(8 + 250, 4, 8, 200)).toBe(-1);
  });
});

describe('chart-math 环形命中', () => {
  const cx = 100;
  const cy = 100;
  const innerR = 30;
  const outerR = 60;
  const percents = [25, 25, 25, 25];

  it('未选中时按半径与角度命中对应扇区', () => {
    // 扇区 0 的中点方向 = -π/4
    const mid = -Math.PI / 4;
    const r = 45;
    const x = cx + Math.cos(mid) * r;
    const y = cy + Math.sin(mid) * r;
    expect(hitDonutSegment(x, y, cx, cy, innerR, outerR, percents, -1, 0)).toBe(0);
  });

  it('圆心空洞与外部都不命中', () => {
    expect(hitDonutSegment(cx, cy, cx, cy, innerR, outerR, percents, -1, 0)).toBe(-1);
    expect(hitDonutSegment(cx + 90, cy, cx, cy, innerR, outerR, percents, -1, 0)).toBe(-1);
  });

  it('扇区外移后仍能按新圆心命中（R-06 关键回归）', () => {
    const off = 10;
    const mid = -Math.PI / 4;
    const ncx = cx + Math.cos(mid) * off;
    const ncy = cy + Math.sin(mid) * off;
    const r = outerR + 4; // 相对新圆心仍在容差内，相对原圆心已超出
    const x = ncx + Math.cos(mid) * r;
    const y = ncy + Math.sin(mid) * r;

    expect(hitDonutSegment(x, y, cx, cy, innerR, outerR, percents, 0, off)).toBe(0);
    // 未考虑外移时会判定为未命中
    expect(hitDonutSegment(x, y, cx, cy, innerR, outerR, percents, -1, 0)).toBe(-1);
  });
});

describe('chart-math 触摸坐标换算', () => {
  it('优先使用 canvas 内坐标 x/y', () => {
    expect(toCanvasPoint({ x: 12, y: 34, clientX: 100, clientY: 120 }, { left: 88, top: 86 }))
      .toEqual({ x: 12, y: 34 });
  });

  it('缺少 x/y 时用 clientX/clientY 减去画布视口偏移', () => {
    expect(toCanvasPoint({ clientX: 100, clientY: 120 }, { left: 88, top: 86 }))
      .toEqual({ x: 12, y: 34 });
  });

  it('两种坐标都缺失时返回 null', () => {
    expect(toCanvasPoint({}, { left: 88, top: 86 })).toBeNull();
  });
});
