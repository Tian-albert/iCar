// 分享卡片绘制：用假 ctx 记录调用，验证绘制指令正确
import { drawShareCard, drawEmptyCard, CARD_COLORS } from '../utils/share-card-draw';
import { buildShareCardModel, computeShareCardLayout, ShareCardInput } from '../utils/share-card';

interface Call {
  op: string;
  args: any[];
}

/** 记录所有绘制调用的假 ctx */
function fakeCtx() {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '' };
  const texts: Array<{ text: string; x: number; y: number; font: string; fill: string }> = [];

  const ctx: any = {
    _calls: calls,
    _texts: texts,
    save: () => calls.push({ op: 'save', args: [] }),
    restore: () => calls.push({ op: 'restore', args: [] }),
    scale: (...a: any[]) => calls.push({ op: 'scale', args: a }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    closePath: () => calls.push({ op: 'closePath', args: [] }),
    moveTo: (...a: any[]) => calls.push({ op: 'moveTo', args: a }),
    lineTo: (...a: any[]) => calls.push({ op: 'lineTo', args: a }),
    arcTo: (...a: any[]) => calls.push({ op: 'arcTo', args: a }),
    fill: () => calls.push({ op: 'fill', args: [state.fillStyle] }),
    fillRect: (...a: any[]) => calls.push({ op: 'fillRect', args: [...a, state.fillStyle] }),
    fillText: (text: string, x: number, y: number) => {
      calls.push({ op: 'fillText', args: [text, x, y] });
      texts.push({ text, x, y, font: state.font, fill: state.fillStyle });
    },
    createLinearGradient: () => {
      const stops: any[] = [];
      return {
        _stops: stops,
        addColorStop: (p: number, c: string) => stops.push([p, c])
      };
    }
  };

  // fillStyle / font 等用属性拦截，便于断言当前样式
  Object.defineProperty(ctx, 'fillStyle', {
    get: () => state.fillStyle,
    set: (v: string) => { state.fillStyle = v; }
  });
  Object.defineProperty(ctx, 'strokeStyle', {
    get: () => state.strokeStyle,
    set: (v: string) => { state.strokeStyle = v; }
  });
  Object.defineProperty(ctx, 'font', {
    get: () => state.font,
    set: (v: string) => { state.font = v; }
  });
  Object.defineProperty(ctx, 'textAlign', {
    get: () => state.textAlign,
    set: (v: string) => { state.textAlign = v; }
  });
  Object.defineProperty(ctx, 'textBaseline', {
    get: () => state.textBaseline,
    set: (v: string) => { state.textBaseline = v; }
  });

  return ctx;
}

function input(over: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    carName: '测试 CRV',
    energyType: 'fuel',
    rangeLabel: '2026年',
    hasData: true,
    mileage: { latest: 5850, increased: 5850, fuelMileage: 5850, evMileage: 0 },
    fuel: { totalCost: 3900, avgConsumption: 8.46, costPerKm: 0.667 },
    electricity: { totalCost: 0, avgConsumption: 0, costPerKm: 0 },
    expense: { total: 8200, perKm: 1.402 },
    categories: [
      { name: '加油', amount: 3900, percent: 47.6 },
      { name: '保养', amount: 2068, percent: 25.2 }
    ],
    ...over
  };
}

describe('drawShareCard 绘制内容', () => {
  it('绘制车名、车型与维度', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('测试 CRV');
    expect(texts).toContain('燃油 · 2026年');
    expect(texts).toContain('车记本');
  });

  it('绘制全部指标标签与数值', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('最新总里程');
    expect(texts).toContain('5850');
    expect(texts).toContain('平均油耗');
    expect(texts).toContain('8.46');
  });

  it('绘制分类名称与占比', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('分类支出');
    expect(texts).toContain('加油');
    expect(texts.some((t: string) => t.includes('47.6%'))).toBe(true);
  });

  it('按 dpr 缩放一次，且 save/restore 配对', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 3 });

    const scaleCalls = ctx._calls.filter((c: Call) => c.op === 'scale');
    expect(scaleCalls.length).toBe(1);
    expect(scaleCalls[0].args).toEqual([3, 3]);

    const saves = ctx._calls.filter((c: Call) => c.op === 'save').length;
    const restores = ctx._calls.filter((c: Call) => c.op === 'restore').length;
    expect(saves).toBe(restores);
  });

  it('无分类时不绘制分类区，但仍有页脚', () => {
    const model = buildShareCardModel(input({ categories: [] }));
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).not.toContain('分类支出');
    expect(texts.some((t: string) => t.includes('车记本'))).toBe(true);
  });

  it('使用品牌色作为底部品牌条渐变', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    const fills = ctx._calls.filter((c: Call) => c.op === 'fillRect');
    const colors = fills.map((c: Call) => c.args[c.args.length - 1]);
    expect(colors).toContain(CARD_COLORS.pageBg);
  });

  it('文字坐标不越界（含右对齐项）', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawShareCard({ ctx, model, layout, dpr: 2 });

    for (const t of ctx._texts as any[]) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe('drawEmptyCard 空态', () => {
  it('绘制空态提示与车名，不绘制指标', () => {
    const model = buildShareCardModel(input({ hasData: false }));
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawEmptyCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('测试 CRV');
    expect(texts).toContain('这段时间还没有记录');
    expect(texts).not.toContain('最新总里程');
  });

  it('dpr 缩放正确且 save/restore 配对', () => {
    const model = buildShareCardModel(input({ hasData: false }));
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawEmptyCard({ ctx, model, layout, dpr: 2 });

    const scaleCalls = ctx._calls.filter((c: Call) => c.op === 'scale');
    expect(scaleCalls.length).toBe(1);
    const saves = ctx._calls.filter((c: Call) => c.op === 'save').length;
    const restores = ctx._calls.filter((c: Call) => c.op === 'restore').length;
    expect(saves).toBe(restores);
  });
});
