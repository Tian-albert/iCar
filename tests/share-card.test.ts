// 统计页分享卡片：数据模型与布局（1:1 复刻统计页）
import {
  buildShareCardModel,
  computeShareCardLayout,
  formatRangeLabel,
  CARD_WIDTH,
  MAX_CATEGORY_ROWS,
  Rect,
  ShareCardInput
} from '../utils/share-card';
import { EnergyType } from '../types/models';

function input(over: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    carName: '测试 CRV',
    energyType: 'fuel' as EnergyType,
    rangeLabel: '2026年',
    hasData: true,
    mileage: { latest: 5850, increased: 5850, fuelMileage: 5850, evMileage: 0 },
    fuel: { totalCost: 3900, avgConsumption: 8.46, costPerKm: 0.667 },
    electricity: { totalCost: 0, avgConsumption: 0, costPerKm: 0 },
    expense: { total: 8200, perKm: 1.402, perKmExFuel: 0.735 },
    categories: [
      { name: '加油', amount: 3900, percent: 47.56, color: '#3B6FF6' },
      { name: '保养', amount: 2068, percent: 25.22, color: '#22C55E' },
      { name: '维修', amount: 940, percent: 11.46, color: '#F59E0B' },
      { name: '保险', amount: 3800, percent: 46.34, color: '#EF4444' }
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

describe('指标卡组：与统计页结构一一对应', () => {
  it('燃油车：里程 / 油耗 / 支出 三组，无电耗组', () => {
    const m = buildShareCardModel(input());
    expect(m.energyLabel).toBe('燃油');
    expect(m.groups.map(g => g.key)).toEqual(['mileage', 'fuel', 'expense']);
  });

  it('纯电车：里程 / 电耗 / 支出，无油耗组', () => {
    const m = buildShareCardModel(input({
      energyType: 'ev',
      mileage: { latest: 5460, increased: 5460, fuelMileage: 0, evMileage: 5460 },
      electricity: { totalCost: 620, avgConsumption: 16.5, costPerKm: 0.114 }
    }));
    expect(m.energyLabel).toBe('纯电');
    expect(m.groups.map(g => g.key)).toEqual(['mileage', 'electricity', 'expense']);
  });

  it('混动车：里程 / 油耗 / 电耗 / 支出 四组', () => {
    const m = buildShareCardModel(input({
      energyType: 'hybrid',
      mileage: { latest: 5400, increased: 5400, fuelMileage: 3600, evMileage: 1800 },
      electricity: { totalCost: 380, avgConsumption: 15.2, costPerKm: 0.21 }
    }));
    expect(m.energyLabel).toBe('混动');
    expect(m.groups.map(g => g.key)).toEqual(['mileage', 'fuel', 'electricity', 'expense']);
  });

  it('每组固定 3 列（与页面 metric-card 三列一致）', () => {
    for (const et of ['fuel', 'ev', 'hybrid'] as EnergyType[]) {
      const m = buildShareCardModel(input({
        energyType: et,
        electricity: { totalCost: 100, avgConsumption: 15, costPerKm: 0.2 }
      }));
      for (const g of m.groups) {
        expect(g.metrics.length).toBe(3);
      }
    }
  });
});

describe('指标取值', () => {
  it('纯电车里程取 evMileage（不取恒为 0 的 fuelMileage）', () => {
    const m = buildShareCardModel(input({
      energyType: 'ev',
      mileage: { latest: 5460, increased: 5460, fuelMileage: 0, evMileage: 5460 }
    }));
    const mileage = m.groups.find(g => g.key === 'mileage')!;
    expect(mileage.metrics[2].label).toBe('充电里程 (km)');
    expect(mileage.metrics[2].value).toBe('5460');
  });

  it('标签与统计页文案一致', () => {
    const m = buildShareCardModel(input());
    const fuel = m.groups.find(g => g.key === 'fuel')!;
    expect(fuel.metrics.map(x => x.label)).toEqual([
      '总油费 (元)',
      '平均油耗 (L/100km)',
      '平均油耗 (元/km)'
    ]);
  });

  it('数值精度：金额 2 位、每公里 3 位', () => {
    const m = buildShareCardModel(input());
    const fuel = m.groups.find(g => g.key === 'fuel')!;
    expect(fuel.metrics[0].value).toBe('3900.00');
    expect(fuel.metrics[2].value).toBe('0.667');
  });

  it('无数据时全部占位符', () => {
    const m = buildShareCardModel(input({ hasData: false }));
    for (const g of m.groups) {
      for (const x of g.metrics) {
        expect(x.value).toBe('--');
      }
    }
  });

  it('NaN 视为无数据', () => {
    const m = buildShareCardModel(input({
      fuel: { totalCost: NaN, avgConsumption: NaN, costPerKm: NaN }
    }));
    const fuel = m.groups.find(g => g.key === 'fuel')!;
    expect(fuel.metrics[0].value).toBe('--');
    expect(fuel.metrics[1].value).toBe('--');
  });
});

describe('图表数据：三张图与页面同源', () => {
  it('趋势标题按车型切换单位', () => {
    expect(buildShareCardModel(input()).trendTitle).toBe('能耗趋势 (L/100km)');
    expect(buildShareCardModel(input({
      energyType: 'ev',
      trendUnit: 'kWh/100km'
    })).trendTitle).toBe('电耗趋势 (kWh/100km)');
  });

  it('趋势数据原样传递（不做二次聚合）', () => {
    const trend = [{ label: '1/10', value: 8.2 }, { label: '3/15', value: 8.6 }];
    const m = buildShareCardModel(input({ trend }));
    expect(m.trend).toEqual(trend);
  });

  it('行程与费用数据原样传递，空数组标记为空态', () => {
    const m = buildShareCardModel(input({ monthlyMileage: [], monthlyCost: [] }));
    expect(m.monthlyMileageEmpty).toBe(true);
    expect(m.monthlyCostEmpty).toBe(true);
  });

  it('趋势空态文案按车型区分', () => {
    expect(buildShareCardModel(input()).trendEmptyText).toContain('加油');
    expect(buildShareCardModel(input({ energyType: 'ev' })).trendEmptyText).toContain('充电');
  });
});

describe('分类支出', () => {
  it('按金额降序', () => {
    const m = buildShareCardModel(input());
    const amounts = m.categoryRows.map(c => Number(c.amount));
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('明细列表超过上限时截断，但环形图保留全量', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `类别${i}`,
      amount: 100 - i,
      percent: 10,
      color: '#3B6FF6'
    }));
    const m = buildShareCardModel(input({ categories: many }));
    expect(m.categories.length).toBe(9);
    expect(m.categoryRows.length).toBe(MAX_CATEGORY_ROWS);
  });

  it('保留颜色，供明细圆点使用', () => {
    const m = buildShareCardModel(input());
    expect(m.categoryRows[0].color).toMatch(/^#/);
  });

  it('金额为 0 或非法的分类被过滤', () => {
    const m = buildShareCardModel(input({
      categories: [
        { name: '有效', amount: 100, percent: 50, color: '#3B6FF6' },
        { name: '零', amount: 0, percent: 0, color: '#22C55E' },
        { name: '非法', amount: NaN, percent: NaN, color: '#F59E0B' }
      ]
    }));
    expect(m.categoryRows.length).toBe(1);
    expect(m.categoryRows[0].name).toBe('有效');
  });
});

describe('formatRangeLabel', () => {
  it('月 / 年 / 全部', () => {
    expect(formatRangeLabel({ type: 'month', year: 2026, month: 7 })).toBe('2026年7月');
    expect(formatRangeLabel({ type: 'year', year: 2026 })).toBe('2026年');
    expect(formatRangeLabel({ type: 'all' })).toBe('全部时间');
  });
});

describe('布局：1:1 复刻页面结构', () => {
  it('宽度固定 750，元素在宽度内', () => {
    const m = buildShareCardModel(input());
    const lay = computeShareCardLayout(m);
    expect(lay.width).toBe(CARD_WIDTH);

    for (const g of lay.groupRects) {
      expect(g.rect.x).toBeGreaterThanOrEqual(0);
      expect(g.rect.x + g.rect.width).toBeLessThanOrEqual(CARD_WIDTH);
    }
    for (const r of lay.categoryRowRects) {
      expect(r.x + r.width).toBeLessThanOrEqual(CARD_WIDTH);
    }
  });

  it('详细模式区块自上而下顺序正确（头部 → 指标 → 分类 → 趋势 → 行程 → 费用）', () => {
    const m = buildShareCardModel(input(), 'full');
    const lay = computeShareCardLayout(m);

    const trend = lay.trendCard!;
    const mileage = lay.mileageCard!;
    const cost = lay.costCard!;
    expect(trend).not.toBeNull();
    expect(mileage).not.toBeNull();
    expect(cost).not.toBeNull();

    const lastGroup = lay.groupRects[lay.groupRects.length - 1].rect;
    expect(lay.header.y + lay.header.height).toBeLessThan(lay.groupRects[0].rect.y);
    expect(lastGroup.y + lastGroup.height).toBeLessThan(lay.categoryCard.y);
    expect(lay.categoryCard.y + lay.categoryCard.height).toBeLessThan(trend.y);
    expect(trend.y + trend.height).toBeLessThan(mileage.y);
    expect(mileage.y + mileage.height).toBeLessThan(cost.y);
    expect(cost.y + cost.height).toBeLessThan(lay.footerBaseline);
  });

  it('高度容纳全部内容与页脚', () => {
    const m = buildShareCardModel(input(), 'full');
    const lay = computeShareCardLayout(m);
    const cost = lay.costCard!;
    expect(lay.height).toBeGreaterThan(lay.footerBaseline);
    expect(lay.height).toBeGreaterThan(cost.y + cost.height);
  });

  it('指标卡组数量随车型变化', () => {
    const fuel = computeShareCardLayout(buildShareCardModel(input()));
    const hybrid = computeShareCardLayout(buildShareCardModel(input({
      energyType: 'hybrid',
      electricity: { totalCost: 100, avgConsumption: 15, costPerKm: 0.2 }
    })));
    expect(fuel.groupRects.length).toBe(3);
    expect(hybrid.groupRects.length).toBe(4);
    // 多一组指标 → 卡片更高
    expect(hybrid.height).toBeGreaterThan(fuel.height);
  });

  it('分类行不重叠且依次排列', () => {
    const m = buildShareCardModel(input());
    const lay = computeShareCardLayout(m);
    for (let i = 1; i < lay.categoryRowRects.length; i++) {
      const prev = lay.categoryRowRects[i - 1];
      const cur = lay.categoryRowRects[i];
      expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.height);
    }
  });

  it('环形图区域在分类卡内部', () => {
    const m = buildShareCardModel(input());
    const lay = computeShareCardLayout(m);
    expect(lay.donutRect.x).toBeGreaterThanOrEqual(lay.categoryCard.x);
    expect(lay.donutRect.x + lay.donutRect.width)
      .toBeLessThanOrEqual(lay.categoryCard.x + lay.categoryCard.width);
    expect(lay.donutRect.y).toBeGreaterThanOrEqual(lay.categoryCard.y);
  });

  it('三张图表区域都在各自卡片内部', () => {
    const m = buildShareCardModel(input(), 'full');
    const lay = computeShareCardLayout(m);
    const pairs: Array<[Rect | null, Rect | null]> = [
      [lay.trendCard, lay.trendChartRect],
      [lay.mileageCard, lay.mileageChartRect],
      [lay.costCard, lay.costChartRect]
    ];
    for (const [card, chart] of pairs) {
      expect(card).not.toBeNull();
      expect(chart).not.toBeNull();
      const c = card!;
      const ch = chart!;
      expect(ch.x).toBeGreaterThanOrEqual(c.x);
      expect(ch.x + ch.width).toBeLessThanOrEqual(c.x + c.width);
      expect(ch.y + ch.height).toBeLessThanOrEqual(c.y + c.height);
    }
  });
});

describe('精简模式：仅指标卡 + 环形图', () => {
  it('模型记录 mode', () => {
    expect(buildShareCardModel(input(), 'brief').mode).toBe('brief');
    expect(buildShareCardModel(input(), 'full').mode).toBe('full');
  });

  it('精简模式不包含三张图表的布局区域', () => {
    const m = buildShareCardModel(input(), 'brief');
    const lay = computeShareCardLayout(m);
    expect(lay.trendCard).toBeNull();
    expect(lay.trendChartRect).toBeNull();
    expect(lay.mileageCard).toBeNull();
    expect(lay.costCard).toBeNull();
    expect(lay.trendTitleBaseline).toBeNull();
  });

  it('精简模式仍保留指标卡与分类环形图', () => {
    const m = buildShareCardModel(input(), 'brief');
    const lay = computeShareCardLayout(m);
    expect(lay.groupRects.length).toBe(m.groups.length);
    expect(lay.donutRect.width).toBeGreaterThan(0);
    expect(lay.categoryCard.height).toBeGreaterThan(0);
  });

  it('精简模式高度明显小于详细模式', () => {
    const brief = computeShareCardLayout(buildShareCardModel(input(), 'brief'));
    const full = computeShareCardLayout(buildShareCardModel(input(), 'full'));
    expect(brief.height).toBeLessThan(full.height);
    // 少掉三张 300px 图表，差距应在 900px 以上
    expect(full.height - brief.height).toBeGreaterThan(900);
  });

  it('两种模式的指标卡与分类数据完全一致', () => {
    const brief = buildShareCardModel(input(), 'brief');
    const full = buildShareCardModel(input(), 'full');
    expect(brief.groups).toEqual(full.groups);
    expect(brief.categories).toEqual(full.categories);
  });

  it('分类区在精简模式下仍位于页脚之上', () => {
    const m = buildShareCardModel(input(), 'brief');
    const lay = computeShareCardLayout(m);
    expect(lay.categoryCard.y + lay.categoryCard.height).toBeLessThan(lay.footerBaseline);
    expect(lay.height).toBeGreaterThan(lay.footerBaseline);
  });
});
