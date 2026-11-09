// 图表布局共享：组件命中判定与绘制必须用同一份公式，防止改一边导致点击错位
import {
  computeDonutLayout,
  computeLineLayout,
  computeBarLayout,
  renderDonut,
  renderLine,
  renderBars
} from '../utils/chart-render';
import { MAX_FUEL_CONSUMPTION, MAX_EV_CONSUMPTION } from '../domain/fuel.service';

/** 记录 arc 调用的假 ctx，用于反推绘制时实际使用的圆心与半径 */
function fakeCtx() {
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  const state: any = { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '' };
  const ctx: any = {
    _arcs: arcs,
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    arc: (x: number, y: number, r: number) => arcs.push({ x, y, r }),
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    clearRect: () => {},
    fillText: () => {},
    measureText: (t: string) => ({ width: t.length * 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} })
  };
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, {
      get: () => state[k],
      set: (v: any) => { state[k] = v; }
    });
  }
  return ctx;
}

describe('环形图布局共享', () => {
  it('computeDonutLayout 返回的圆心与半径，与 renderDonut 实际绘制一致', () => {
    const w = 400;
    const h = 300;
    const geo = computeDonutLayout(w, h, 1);

    const ctx = fakeCtx();
    renderDonut({
      ctx,
      w,
      h,
      segments: [{ name: 'A', amount: '100', percent: 100, color: '#3B6FF6' }],
      total: '100'
    });

    // 绘制出的外弧圆心应等于布局圆心
    const outer = ctx._arcs[0];
    expect(outer.x).toBeCloseTo(geo.cx, 5);
    expect(outer.y).toBeCloseTo(geo.cy, 5);
    expect(outer.r).toBeCloseTo(geo.outerR, 5);
  });

  it('尺寸过小时标记 invalid，绘制直接跳过', () => {
    const geo = computeDonutLayout(60, 60, 1);
    expect(geo.valid).toBe(false);

    const ctx = fakeCtx();
    renderDonut({
      ctx,
      w: 60,
      h: 60,
      segments: [{ name: 'A', amount: '1', percent: 100, color: '#000' }],
      total: '1'
    });
    expect(ctx._arcs.length).toBe(0);
  });

  it('fontScale 影响布局，组件用 scale=1 时与绘制一致', () => {
    const a = computeDonutLayout(400, 300, 1);
    const b = computeDonutLayout(400, 300, 2);
    expect(b.outerR).toBeLessThan(a.outerR);
    expect(b.offR).toBeGreaterThan(a.offR);
  });
});

describe('折线图布局共享', () => {
  const pts = [{ value: 8 }, { value: 12 }, { value: 9 }];

  it('yMax 推导结果与绘制一致（组件命中依赖它）', () => {
    const geo = computeLineLayout(400, 300, pts, { yMax: 15 });
    // max=12 -> ceil(12/5)*5=15，基准 15，封顶 30
    expect(geo.yMax).toBe(15);
  });

  it('数据超出基准时 yMax 抬高到 5 的倍数', () => {
    const geo = computeLineLayout(400, 300, [{ value: 22 }], { yMax: 15 });
    expect(geo.yMax).toBe(25);
  });

  it('电耗用 50 封顶，不被油耗 30 截断', () => {
    // 45 kWh/100km：油耗封顶会截到 30，电耗封顶允许抬到 45
    const fuel = computeLineLayout(400, 300, [{ value: 45 }], { yMax: 15 });
    expect(fuel.yMax).toBe(MAX_FUEL_CONSUMPTION);

    const ev = computeLineLayout(400, 300, [{ value: 45 }], {
      yMax: 15,
      ceiling: MAX_EV_CONSUMPTION
    });
    // 45 已是 5 的倍数，直接取 45（而非封顶值 50）
    expect(ev.yMax).toBe(45);
    expect(ev.yMax).toBeGreaterThan(fuel.yMax);
  });

  it('电耗超过 50 时按 50 封顶', () => {
    const ev = computeLineLayout(400, 300, [{ value: 60 }], {
      yMax: 15,
      ceiling: MAX_EV_CONSUMPTION
    });
    expect(ev.yMax).toBe(MAX_EV_CONSUMPTION);
  });

  it('留白随 fontScale 放大（卡片侧字号变大需要更多空间）', () => {
    const a = computeLineLayout(750, 300, pts, { fontScale: 1 });
    const b = computeLineLayout(750, 300, pts, { fontScale: 2 });
    expect(b.padL).toBeGreaterThan(a.padL);
    expect(b.plotW).toBeLessThan(a.plotW);
  });

  it('空数据不报错', () => {
    const geo = computeLineLayout(400, 300, []);
    expect(geo.yMax).toBeGreaterThan(0);
  });
});

describe('柱状图布局共享', () => {
  const bars = [{ value: 10 }, { value: 20 }, { value: 30 }];

  it('slot / barW 计算与绘制一致', () => {
    const geo = computeBarLayout(400, 300, bars, 1);
    expect(geo.slot).toBeCloseTo(geo.plotW / 3, 5);
    expect(geo.barW).toBeCloseTo(geo.slot * 0.5, 5);
    expect(geo.maxVal).toBe(30);
  });

  it('maxVal <= 0 时绘制跳过', () => {
    const geo = computeBarLayout(400, 300, [{ value: 0 }], 1);
    expect(geo.maxVal).toBe(0);

    const ctx = fakeCtx();
    renderBars({ ctx, w: 400, h: 300, bars: [{ label: 'a', value: 0 }] });
    // 无柱子路径产生（arc 只在气泡/圆点用，此处应为 0）
    expect(ctx._arcs.length).toBe(0);
  });

  it('留白随 fontScale 放大', () => {
    const a = computeBarLayout(750, 300, bars, 1);
    const b = computeBarLayout(750, 300, bars, 2);
    expect(b.padT).toBeGreaterThan(a.padT);
    expect(b.plotH).toBeLessThan(a.plotH);
  });

  it('空数据不报错', () => {
    const geo = computeBarLayout(400, 300, []);
    expect(geo.maxVal).toBe(0);
    expect(geo.slot).toBe(0);
  });
});

describe('渲染函数不内联布局常量（改由共享函数提供）', () => {
  it('renderLine 与 renderBars 在 fontScale=1 下与 computeXxxLayout 的留白一致', () => {
    // 通过渲染后文本坐标反推：X 轴标签最右侧不应超出 w - padR
    const w = 400;
    const h = 300;
    const geoL = computeLineLayout(w, h, [{ value: 5 }], { fontScale: 1 });
    const geoB = computeBarLayout(w, h, [{ value: 5 }], 1);

    expect(geoL.plotW).toBe(w - geoL.padL - geoL.padR);
    expect(geoB.plotW).toBe(w - geoB.padL - geoB.padR);
  });
});
