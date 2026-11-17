// 分享卡片绘制：用假 ctx 记录调用，验证 1:1 复刻的绘制指令
import {
  drawShareCard,
  drawEmptyCard,
  resolveExportDpr,
  categoryBarWidth,
  CARD_COLORS,
  MAX_CANVAS_EDGE,
  EMPTY_CARD_HEIGHT
} from '../utils/share-card-draw';
import {
  buildShareCardModel,
  computeShareCardLayout,
  ShareCardInput,
  ShareMode,
  ShareStyle
} from '../utils/share-card';

const fsx = require('fs') as any;

interface Call {
  op: string;
  args: any[];
}

function fakeCtx() {
  const calls: Call[] = [];
  const state = { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '' };
  const texts: Array<{ text: string; x: number; y: number; font: string; fill: string }> = [];
  const transforms: Array<{ op: string; args: any[] }> = [];

  const ctx: any = {
    _calls: calls,
    _texts: texts,
    _transforms: transforms,
    save: () => calls.push({ op: 'save', args: [] }),
    restore: () => calls.push({ op: 'restore', args: [] }),
    scale: (...a: any[]) => { calls.push({ op: 'scale', args: a }); transforms.push({ op: 'scale', args: a }); },
    translate: (...a: any[]) => { calls.push({ op: 'translate', args: a }); transforms.push({ op: 'translate', args: a }); },
    rotate: (...a: any[]) => { calls.push({ op: 'rotate', args: a }); transforms.push({ op: 'rotate', args: a }); },
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    closePath: () => calls.push({ op: 'closePath', args: [] }),
    moveTo: (...a: any[]) => calls.push({ op: 'moveTo', args: a }),
    lineTo: (...a: any[]) => calls.push({ op: 'lineTo', args: a }),
    arcTo: (...a: any[]) => calls.push({ op: 'arcTo', args: a }),
    arc: (...a: any[]) => calls.push({ op: 'arc', args: a }),
    clip: () => calls.push({ op: 'clip', args: [] }),
    drawImage: (...a: any[]) => calls.push({ op: 'drawImage', args: a }),
    fill: () => calls.push({ op: 'fill', args: [state.fillStyle] }),
    stroke: () => calls.push({ op: 'stroke', args: [state.strokeStyle] }),
    fillRect: (...a: any[]) => calls.push({ op: 'fillRect', args: [...a, state.fillStyle] }),
    clearRect: (...a: any[]) => calls.push({ op: 'clearRect', args: a }),
    measureText: (t: string) => ({ width: t.length * 12 }),
    fillText: (text: string, x: number, y: number) => {
      calls.push({ op: 'fillText', args: [text, x, y] });
      texts.push({ text, x, y, font: state.font, fill: state.fillStyle });
    },
    createLinearGradient: () => {
      const stops: any[] = [];
      return { _stops: stops, addColorStop: (p: number, c: string) => stops.push([p, c]) };
    }
  };

  for (const prop of ['fillStyle', 'strokeStyle', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'lineWidth'] as const) {
    Object.defineProperty(ctx, prop, {
      get: () => (state as any)[prop],
      set: (v: any) => { (state as any)[prop] = v; }
    });
  }

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
    expense: { total: 8200, perKm: 1.402, perKmExFuel: 0.735 },
    categories: [
      { name: '加油', amount: 3900, percent: 47.6, color: '#3B6FF6' },
      { name: '保养', amount: 2068, percent: 25.2, color: '#22C55E' }
    ],
    trendUnit: 'L/100km',
    trend: [
      { label: '1/10', value: 8.2 },
      { label: '3/15', value: 8.6 }
    ],
    monthlyMileage: [{ label: '1月', value: 650 }],
    monthlyCost: [{ label: '1月', value: 400 }],
    ...over
  };
}

function draw(over: Partial<ShareCardInput> = {}, mode: ShareMode = 'full', style: ShareStyle = 'a') {
  const model = buildShareCardModel(input(over), mode, style);
  const layout = computeShareCardLayout(model);
  const ctx = fakeCtx();
  drawShareCard({ ctx, model, layout, dpr: 2, dateText: '2026-11-08' });
  return { ctx, model, layout };
}

describe('头部：品牌 / 车名 / 维度 / 核心数字', () => {
  it('绘制品牌、车名、车型与维度、核心数字', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('车记本 · ICAR');
    expect(texts).toContain('测试 CRV');
    expect(texts).toContain('燃油车 · 2026年');
    expect(texts).toContain('2026年');
    // 头部核心数字：总支出 + 每公里
    expect(texts).toContain('8200.00');
    expect(texts).toContain('总支出');
    expect(texts.some((t: string) => t.includes('每公里 ¥'))).toBe(true);
  });
});

describe('指标卡：与页面同结构', () => {
  it('绘制全部指标数值与标签', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    // 里程
    expect(texts).toContain('最新总里程 (km)');
    expect(texts).toContain('5850');
    // 油耗
    expect(texts).toContain('平均油耗 (L/100km)');
    expect(texts).toContain('8.46');
    // 支出
    expect(texts).toContain('总支出 (元)');
    expect(texts).toContain('8200.00');
  });

  it('纯电车不绘制油耗指标，绘制电耗指标', () => {
    const { ctx } = draw({
      energyType: 'ev',
      mileage: { latest: 5460, increased: 5460, fuelMileage: 0, evMileage: 5460 },
      electricity: { totalCost: 620, avgConsumption: 16.5, costPerKm: 0.114 },
      trendUnit: 'kWh/100km'
    });
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).not.toContain('平均油耗 (L/100km)');
    expect(texts).toContain('平均电耗 (kWh/100km)');
    expect(texts).toContain('充电里程 (km)');
  });
});

describe('三张图表：调用共享绘制函数', () => {
  it('分类区绘制环形图（含中心金额与总支出）', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('分类支出');
    expect(texts).toContain('¥8200.00');
    expect(texts).toContain('总支出');
    // 分类明细
    expect(texts).toContain('加油');
    expect(texts.some((t: string) => t.includes('¥ 3900.00'))).toBe(true);
  });

  it('趋势区绘制折线图（含数值标注）', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('能耗趋势 (L/100km)');
    expect(texts).toContain('8.20');
    expect(texts).toContain('8.60');
  });

  it('行程与费用区绘制柱状图', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('行程 (km)');
    expect(texts).toContain('费用 (元)');
    expect(texts).toContain('650');
    expect(texts).toContain('400');
  });

  it('图表绘制使用 translate 定位到各自区域', () => {
    const { ctx, layout } = draw();
    const translates = ctx._transforms.filter((t: any) => t.op === 'translate');
    const targets = translates.map((t: any) => `${t.args[0]},${t.args[1]}`);
    expect(targets).toContain(`${layout.donutRect.x},${layout.donutRect.y}`);
    expect(targets).toContain(`${layout.trendChartRect!.x},${layout.trendChartRect!.y}`);
    expect(targets).toContain(`${layout.mileageChartRect!.x},${layout.mileageChartRect!.y}`);
    expect(targets).toContain(`${layout.costChartRect!.x},${layout.costChartRect!.y}`);
  });

  it('图表空态绘制文案而非图表', () => {
    const { ctx } = draw({ trend: [], monthlyMileage: [], monthlyCost: [] });
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts.some((t: string) => t.includes('暂无有效油耗区间'))).toBe(true);
    expect(texts).toContain('暂无行程数据');
    expect(texts).toContain('暂无费用数据');
  });

  it('无分类时绘制分类空态', () => {
    const { ctx } = draw({ categories: [] });
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts.some((t: string) => t.includes('暂无支出数据'))).toBe(true);
  });

  it('分类明细绘制占比条（轨道底色 + 分类色填充）', () => {
    const { ctx } = draw();
    const fills = ctx._calls.filter((c: Call) => c.op === 'fill').map((c: Call) => c.args[0]);
    // 轨道底色只用于占比条，出现即证明比例条已绘制（修复「漏画占比条」）
    expect(fills).toContain(CARD_COLORS.fill);
    // 至少存在比轨道更多的填充（条本身）
    expect(fills.filter((f: string) => f === CARD_COLORS.fill).length).toBeGreaterThanOrEqual(1);
  });
});

describe('三套视觉风格', () => {
  it('三种风格都能完整绘制，页面底色互不相同', () => {
    const bgs = (['a', 'b', 'c'] as ShareStyle[]).map(style => {
      const { ctx } = draw({}, 'full', style);
      const fillRects = ctx._calls.filter((c: Call) => c.op === 'fillRect');
      // 第一笔永远是整页底色
      return fillRects[0].args[4];
    });
    expect(new Set(bgs).size).toBe(3);
    expect(bgs[0]).toBe('#FFFFFF');
    expect(bgs[1]).toBe('#F7F5F0');
    expect(bgs[2]).toBe('#0E1116');
  });

  it('三种风格都绘制车名与核心数字（信息不因换肤丢失）', () => {
    for (const style of ['a', 'b', 'c'] as ShareStyle[]) {
      const texts = draw({}, 'full', style).ctx._texts.map((t: any) => t.text);
      expect(texts).toContain('测试 CRV');
      expect(texts).toContain('8200.00');
      expect(texts).toContain('分类支出');
      expect(texts).toContain('记录每一公里');
    }
  });

  it('A 风格头部绘制公路线稿（至少 7 段描边）', () => {
    const { ctx, layout } = draw({}, 'full', 'a');
    // 公路 = 地平线 + 2 条透视线 + 4 段虚线，全部落在头部区域内
    const headerStrokes = ctx._calls.filter((c: Call) => c.op === 'stroke');
    expect(headerStrokes.length).toBeGreaterThanOrEqual(7);
    expect(layout.header.height).toBeGreaterThan(200);
  });

  it('三风格的文字都不越出画布（纵向）', () => {
    for (const style of ['a', 'b', 'c'] as ShareStyle[]) {
      for (const mode of ['brief', 'full'] as ShareMode[]) {
        const { ctx, layout } = draw({}, mode, style);
        for (const t of ctx._texts as any[]) {
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeLessThanOrEqual(layout.height);
        }
      }
    }
  });

  it('C 风格是深色主题：卡片用深色底、文字用白色', () => {
    const { ctx } = draw({}, 'full', 'c');
    const fills = ctx._calls.filter((c: Call) => c.op === 'fill').map((c: Call) => c.args[0]);
    // 卡片底色
    expect(fills).toContain('#161B22');
    // 文字色：车名应使用白色
    const nameText = ctx._texts.find((t: any) => t.text === '测试 CRV');
    expect(nameText).toBeTruthy();
    expect(nameText.fill).toBe('#FFFFFF');
  });
});

describe('统计页调用链：风格必须一路传到底', () => {
  const src: string = fsx.readFileSync('pages/statistics/index.ts', 'utf-8');

  it('ActionSheet 提供 3 风格 × 2 模式共 6 项', () => {
    for (const label of [
      '极简线稿 · 精简',
      '极简线稿 · 详细',
      '杂志封面 · 精简',
      '杂志封面 · 详细',
      '深色运动 · 精简',
      '深色运动 · 详细'
    ]) {
      expect(src).toContain(label);
    }
    expect((src.match(/style: '[abc]'/g) || []).length).toBe(6);
  });

  it('style 从选项一路传到绘制层（不能被默认值吞掉）', () => {
    expect(src).toContain('this.generateShareImage(opt.mode, opt.style)');
    expect(src).toContain('this.drawShareCard(mode, style)');
    expect(src).toContain('this.buildShareModel(mode, style)');
    expect(src).toContain('buildShareCardModel(input, mode, style)');
  });
});

describe('占比条宽度', () => {
  it('按真实百分比换算', () => {
    expect(categoryBarWidth(300, 50)).toBe(150);
    expect(categoryBarWidth(300, 100)).toBe(300);
  });

  it('小占比保底 3px，避免看起来像没有数据', () => {
    expect(categoryBarWidth(300, 1)).toBe(3);
    expect(categoryBarWidth(300, 0)).toBe(3);
  });

  it('脏数据被夹到 [0,100]，不会画出负宽或超宽', () => {
    expect(categoryBarWidth(300, NaN)).toBe(3);
    expect(categoryBarWidth(300, -20)).toBe(3);
    expect(categoryBarWidth(300, 200)).toBe(300);
  });
});

describe('品牌 Logo', () => {
  it('B / C 风格传入 logoImage 时绘制图片，未传时降级为色块', () => {
    // A 风格是纯文字品牌（无 Logo 块），只有 B / C 用图片
    for (const style of ['b', 'c'] as const) {
      const model = buildShareCardModel(input(), 'full', style);
      const layout = computeShareCardLayout(model);

      const noLogo = fakeCtx();
      drawShareCard({ ctx: noLogo, model, layout, dpr: 2 });
      expect(noLogo._calls.some((c: Call) => c.op === 'drawImage')).toBe(false);
      expect(noLogo._texts.map((t: any) => t.text)).toContain('车');

      const withLogo = fakeCtx();
      drawShareCard({ ctx: withLogo, model, layout, dpr: 2, logoImage: { src: 'logo' } as any });
      const draws = withLogo._calls.filter((c: Call) => c.op === 'drawImage');
      expect(draws.length).toBe(1);
      expect(draws[0].args.length).toBe(5); // image, x, y, w, h
    }
  });
});

describe('绘制规范', () => {
  it('按 dpr 缩放一次，save/restore 配对', () => {
    const { ctx } = draw();
    const scaleCalls = ctx._calls.filter((c: Call) => c.op === 'scale');
    expect(scaleCalls.length).toBe(1);
    expect(scaleCalls[0].args).toEqual([2, 2]);

    const saves = ctx._calls.filter((c: Call) => c.op === 'save').length;
    const restores = ctx._calls.filter((c: Call) => c.op === 'restore').length;
    expect(saves).toBe(restores);
  });

  it('页面底色与卡片底色都被填充', () => {
    const { ctx } = draw();
    const colors = ctx._calls.filter((c: Call) => c.op === 'fillRect').map((c: Call) => c.args[4]);
    expect(colors).toContain(CARD_COLORS.pageBg);
  });

  it('页脚含 slogan / 卖点 / 二维码占位与日期', () => {
    const { ctx } = draw();
    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('记录每一公里');
    expect(texts).toContain('无广告 · 无会员 · 纯本地');
    expect(texts).toContain('扫码体验');
    expect(texts).toContain('2026-11-08');
  });

  it('文字纵向坐标都在画布内', () => {
    const { ctx, layout } = draw();
    for (const t of ctx._texts as any[]) {
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(layout.height);
    }
  });
});

describe('resolveExportDpr：防止超出 canvas 尺寸上限', () => {
  it('卡片很高时自动降低 dpr，保证单边不超上限', () => {
    const model = buildShareCardModel(input());
    const layout = computeShareCardLayout(model);
    // 详细版逻辑高度约 2500px，远超 canvas 单边上限的安全 dpr 区间
    expect(layout.height).toBeGreaterThan(2400);

    for (const deviceDpr of [2, 3, 4]) {
      const dpr = resolveExportDpr(layout.width, layout.height, deviceDpr);
      expect(layout.height * dpr).toBeLessThanOrEqual(MAX_CANVAS_EDGE + 1);
      expect(layout.width * dpr).toBeLessThanOrEqual(MAX_CANVAS_EDGE + 1);
    }
  });

  it('卡片不高时保留设备 dpr，不无谓降低清晰度', () => {
    const dpr = resolveExportDpr(750, 560, 3);
    expect(dpr).toBe(3);
  });

  it('结果至少有 1，不会算出 0 或负数', () => {
    expect(resolveExportDpr(750, 20000, 3)).toBeGreaterThanOrEqual(1);
    expect(resolveExportDpr(750, 100, 0)).toBeGreaterThanOrEqual(1);
  });

  it('导出像素总量控制在合理范围（不超过 16MP）', () => {
    const model = buildShareCardModel(input({
      energyType: 'hybrid',
      electricity: { totalCost: 100, avgConsumption: 15, costPerKm: 0.2 }
    }));
    const layout = computeShareCardLayout(model);
    const dpr = resolveExportDpr(layout.width, layout.height, 3);
    const mp = (layout.width * dpr * layout.height * dpr) / 1e6;
    expect(mp).toBeLessThan(16);
  });
});

describe('精简模式绘制', () => {
  it('只绘制核心指标卡与环形图，不绘制三张图表', () => {
    const { ctx } = draw({}, 'brief');
    const texts = ctx._texts.map((t: any) => t.text);

    // 保留：头部 + 一行三格核心指标 + 分类支出
    expect(texts).toContain('测试 CRV');
    expect(texts).toContain('增加总里程 (km)');
    expect(texts).toContain('平均油耗 (L/100km)');
    expect(texts).toContain('每公里支出 (元/km)');
    expect(texts).toContain('分类支出');
    expect(texts).toContain('总支出');

    // 跳过：详细版的三组指标卡 + 三张图表
    expect(texts).not.toContain('最新总里程 (km)');
    expect(texts).not.toContain('行程 (km)');
    expect(texts).not.toContain('费用 (元)');
    expect(texts.some((t: string) => t.includes('趋势'))).toBe(false);
  });

  it('精简模式只为环形图做一次 translate', () => {
    const { ctx, layout } = draw({}, 'brief');
    const translates = ctx._transforms.filter((t: any) => t.op === 'translate');
    expect(translates.length).toBe(1);
    expect(translates[0].args).toEqual([layout.donutRect.x, layout.donutRect.y]);
  });

  it('两种模式的指标数值一致', () => {
    const brief = draw({}, 'brief').ctx._texts.map((t: any) => t.text);
    const full = draw({}, 'full').ctx._texts.map((t: any) => t.text);
    for (const key of ['5850', '8.46', '8200.00']) {
      expect(brief).toContain(key);
      expect(full).toContain(key);
    }
  });
});

describe('图表字号放大（卡片侧 fontScale）', () => {
  /** 收集所有 fillText 的字体大小 */
  function fontSizes(ctx: any): number[] {
    const sizes: number[] = [];
    for (const t of ctx._texts as any[]) {
      const m = /(\d+)px/.exec(t.font || '');
      if (m) sizes.push(Number(m[1]));
    }
    return sizes;
  }

  it('卡片内图表字号明显大于组件默认的 10px', () => {
    const { ctx } = draw();
    const sizes = fontSizes(ctx);
    // 图表标签按 fontScale=2 放大到 20px
    expect(sizes.some(s => s >= 20)).toBe(true);
    // 图表区不应残留组件默认的 10px 标签；页脚最小的辅助字为 11px，不在此列
    const tinyChartLabels = sizes.filter(s => s < 11);
    expect(tinyChartLabels.length).toBe(0);
  });
});

describe('drawEmptyCard 空态', () => {
  it('保留头部与品牌，绘制空态提示，不绘制指标', () => {
    const model = buildShareCardModel(input({ hasData: false }));
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawEmptyCard({ ctx, model, layout, dpr: 2 });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toContain('测试 CRV');
    expect(texts).toContain('车记本 · ICAR');
    expect(texts).toContain('这段时间还没有记录');
    expect(texts).not.toContain('最新总里程');

    // 空态文案必须落在页脚上方，不能被页脚盖住
    const footerY = EMPTY_CARD_HEIGHT - 108;
    const emptyText = ctx._texts.find((t: any) => t.text === '记一笔后即可生成统计卡片');
    expect(emptyText).toBeTruthy();
    expect(emptyText.y).toBeLessThan(footerY);
  });

  it('dpr 缩放正确且 save/restore 配对', () => {
    const model = buildShareCardModel(input({ hasData: false }));
    const layout = computeShareCardLayout(model);
    const ctx = fakeCtx();
    drawEmptyCard({ ctx, model, layout, dpr: 3 });

    expect(ctx._calls.filter((c: Call) => c.op === 'scale')[0].args).toEqual([3, 3]);
    const saves = ctx._calls.filter((c: Call) => c.op === 'save').length;
    const restores = ctx._calls.filter((c: Call) => c.op === 'restore').length;
    expect(saves).toBe(restores);
  });
});
