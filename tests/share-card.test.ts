// 统计页分享卡片：数据模型与布局（纯函数，可单测）
import {
  buildShareCardModel,
  computeShareCardLayout,
  formatRangeLabel,
  CARD_WIDTH,
  MAX_CATEGORIES,
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
    expense: { total: 8200, perKm: 1.402 },
    categories: [
      { name: '加油', amount: 3900, percent: 47.56 },
      { name: '保养', amount: 2068, percent: 25.22 },
      { name: '维修', amount: 940, percent: 11.46 },
      { name: '保险', amount: 3800, percent: 46.34 }
    ],
    ...over
  };
}

describe('buildShareCardModel 车型分支', () => {
  it('燃油车：使用加油里程与油耗指标', () => {
    const m = buildShareCardModel(input());
    expect(m.energyLabel).toBe('燃油');
    const labels = m.metrics.map(x => x.label);
    expect(labels).toContain('加油里程');
    expect(labels).not.toContain('充电里程');
    expect(labels).toContain('平均油耗');
    expect(labels).not.toContain('平均电耗');
    expect(m.metrics.length).toBe(8);
  });

  it('纯电车：使用充电里程与电耗指标，且不出现油耗项', () => {
    const m = buildShareCardModel(input({
      energyType: 'ev',
      mileage: { latest: 5460, increased: 5460, fuelMileage: 0, evMileage: 5460 },
      electricity: { totalCost: 620, avgConsumption: 16.5, costPerKm: 0.114 }
    }));
    expect(m.energyLabel).toBe('纯电');
    const labels = m.metrics.map(x => x.label);
    expect(labels).toContain('充电里程');
    expect(labels).not.toContain('加油里程');
    expect(labels).toContain('平均电耗');
    expect(labels).not.toContain('平均油耗');
  });

  it('混动车：油电两组指标同时出现', () => {
    const m = buildShareCardModel(input({
      energyType: 'hybrid',
      mileage: { latest: 5400, increased: 5400, fuelMileage: 3600, evMileage: 1800 },
      electricity: { totalCost: 380, avgConsumption: 15.2, costPerKm: 0.21 }
    }));
    expect(m.energyLabel).toBe('混动');
    const labels = m.metrics.map(x => x.label);
    expect(labels).toContain('加油里程');
    expect(labels).toContain('充电里程');
    expect(labels).toContain('总油费');
    expect(labels).toContain('总电费');
  });

  it('纯电车里程取 evMileage，不取恒为 0 的 fuelMileage', () => {
    const m = buildShareCardModel(input({
      energyType: 'ev',
      mileage: { latest: 5460, increased: 5460, fuelMileage: 0, evMileage: 5460 }
    }));
    const mileageMetric = m.metrics.find(x => x.label === '充电里程');
    expect(mileageMetric!.value).toBe('5460');
  });
});

describe('buildShareCardModel 数值格式', () => {
  it('无数据时全部显示占位符，不把"没数据"呈现成 0.00', () => {
    const m = buildShareCardModel(input({ hasData: false }));
    expect(m.hasData).toBe(false);
    for (const metric of m.metrics) {
      expect(metric.value).toBe('--');
    }
  });

  it('有数据时保留合理精度', () => {
    const m = buildShareCardModel(input());
    expect(m.metrics.find(x => x.label === '平均油耗')!.value).toBe('8.46');
    expect(m.metrics.find(x => x.label === '总油费')!.value).toBe('3900.00');
  });

  it('NaN 不被当作有效数值', () => {
    const m = buildShareCardModel(input({
      fuel: { totalCost: NaN, avgConsumption: NaN, costPerKm: NaN }
    }));
    expect(m.metrics.find(x => x.label === '总油费')!.value).toBe('--');
    expect(m.metrics.find(x => x.label === '平均油耗')!.value).toBe('--');
  });
});

describe('buildShareCardModel 分类截断', () => {
  it('超过上限时合并为「其他」，且总数不超过上限', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      name: `类别${i}`,
      amount: 100 - i * 5,
      percent: 10 - i
    }));
    const m = buildShareCardModel(input({ categories: many }));
    expect(m.categories.length).toBe(MAX_CATEGORIES);
    expect(m.categories[m.categories.length - 1].name).toBe('其他');
  });

  it('不超过上限时原样保留，且按金额降序', () => {
    const m = buildShareCardModel(input());
    expect(m.categories.length).toBe(4);
    const amounts = m.categories.map(c => Number(c.amount));
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
  });

  it('无分类时不生成「其他」行', () => {
    const m = buildShareCardModel(input({ categories: [] }));
    expect(m.categories.length).toBe(0);
  });
});

describe('formatRangeLabel', () => {
  it('月 / 年 / 全部三种维度', () => {
    expect(formatRangeLabel({ type: 'month', year: 2026, month: 7 })).toBe('2026年7月');
    expect(formatRangeLabel({ type: 'year', year: 2026 })).toBe('2026年');
    expect(formatRangeLabel({ type: 'all' })).toBe('全部时间');
  });
});

describe('computeShareCardLayout 布局', () => {
  it('高度随分类数量增长', () => {
    const few = buildShareCardModel(input({ categories: [] }));
    const many = buildShareCardModel(input());
    expect(computeShareCardLayout(many).height).toBeGreaterThan(computeShareCardLayout(few).height);
  });

  it('所有元素在画布宽度内', () => {
    const model = buildShareCardModel(input());
    const lay = computeShareCardLayout(model);
    expect(lay.width).toBe(CARD_WIDTH);
    for (const m of lay.metrics) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(CARD_WIDTH);
    }
    for (const c of lay.categories) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.barWidth).toBeGreaterThanOrEqual(0);
    }
  });

  it('指标行不重叠，且最后一行在分类区之上', () => {
    const model = buildShareCardModel(input());
    const lay = computeShareCardLayout(model);
    const rows = new Map<number, number>();
    for (const m of lay.metrics) {
      rows.set(m.y, (rows.get(m.y) ?? 0) + 1);
    }
    // 每行最多 2 个指标
    for (const count of rows.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
    const maxMetricBottom = Math.max(...lay.metrics.map(m => m.y + m.height));
    expect(maxMetricBottom).toBeLessThanOrEqual(lay.categoryTitleBaseline ?? lay.footerBaseline);
  });

  it('页脚在所有内容之下，且整体高度容纳页脚', () => {
    const model = buildShareCardModel(input());
    const lay = computeShareCardLayout(model);
    expect(lay.footerBaseline).toBeGreaterThan(lay.metrics[lay.metrics.length - 1].y);
    expect(lay.height).toBeGreaterThan(lay.footerBaseline);
  });

  it('分类百分比映射为 0~1 的条宽比例', () => {
    const model = buildShareCardModel(input());
    const lay = computeShareCardLayout(model);
    for (const c of lay.categories) {
      expect(c.barWidth).toBeGreaterThanOrEqual(0);
      expect(c.barWidth).toBeLessThanOrEqual(c.barMaxWidth);
    }
  });
});
