// 数据总览（全车汇总）与图表粒度
//
// 两个必须锁死的行为：
//   ① 粒度跟着区间走（年→月、月→日、全部→年）——否则月视图只有一根柱子；
//   ② 全车合计的每公里成本 = 全部支出 ÷ 全部有效里程，不能用某辆车的数。
import { buildStats, groupByGranularity, resolveRange, trendGranularityOf } from '../domain/stats.service';
import { buildSummary } from '../domain/summary.service';

function car(id: string, name: string, energyType: string, mileages = 10000): any {
  return {
    sourceId: id,
    sourcePlatform: 'mp',
    name,
    type: 'car',
    icon: '🚗',
    initDate: new Date(2025, 0, 1).getTime(),
    initMileages: 0,
    mileages,
    evMileages: 0,
    hevMileages: 0,
    batteryCapacity: 0,
    energyType,
    energyTrackingEnabled: true,
    maintainSoonMileage: 500,
    maintainSoonDays: 15,
    createdAt: 0,
    updatedAt: 0,
    deleted: false
  };
}

function cost(id: string, carId: string, categoryId: string, amount: number, y: number, m: number, d: number, fuelRecordSourceId = ''): any {
  return {
    sourceId: id,
    sourcePlatform: 'mp',
    carSourceId: carId,
    categorySourceId: categoryId,
    amount,
    costDate: new Date(y, m - 1, d, 12).getTime(),
    remark: '',
    fuelRecordSourceId,
    maintainHandleSourceId: '',
    createdAt: 0,
    updatedAt: 0,
    deleted: false
  };
}

function refuel(id: string, carId: string, mileage: number, y: number, m: number, d: number, energyType = 'fuel'): any {
  return {
    sourceId: id,
    sourcePlatform: 'mp',
    carSourceId: carId,
    energyType,
    fuelDate: new Date(y, m - 1, d, 12).getTime(),
    makeMileages: mileage,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    unitPrice: 7.8,
    volume: 40,
    shouldPayAmount: 312,
    actualPayAmount: 312,
    isFull: true,
    isLowFuel: false,
    lastRecorded: true,
    chargeBeforePercent: 0,
    chargeAfterPercent: 0,
    remark: '',
    costSourceId: ''
  };
}

const CATEGORIES: any[] = [
  { sourceId: 'cat:park', name: '停车', deleted: false },
  { sourceId: 'cat:fuel', name: '加油', deleted: false }
];

describe('图表粒度跟随区间', () => {
  it('年→月、月→日、全部→年', () => {
    expect(trendGranularityOf({ type: 'year', year: 2026 })).toBe('month');
    expect(trendGranularityOf({ type: 'month', year: 2026, month: 3 })).toBe('day');
    expect(trendGranularityOf({ type: 'all' })).toBe('year');
  });

  it('按日聚合：同一天的多笔合并成一个桶', () => {
    const list = [
      cost('c1', 'A', 'cat:park', 100, 2026, 3, 3),
      cost('c2', 'A', 'cat:park', 50, 2026, 3, 3),
      cost('c3', 'A', 'cat:park', 80, 2026, 3, 7)
    ];
    const points = groupByGranularity(list, (x: any) => x.costDate, (x: any) => x.amount, 'day');
    expect(points).toEqual([
      { label: '3', value: 150 },
      { label: '7', value: 80 }
    ]);
  });

  it('按年聚合：不同年份不会合并', () => {
    const list = [
      cost('c1', 'A', 'cat:park', 100, 2025, 3, 3),
      cost('c2', 'A', 'cat:park', 50, 2025, 7, 3),
      cost('c3', 'A', 'cat:park', 80, 2026, 3, 3)
    ];
    const points = groupByGranularity(list, (x: any) => x.costDate, (x: any) => x.amount, 'year');
    expect(points).toEqual([
      { label: '2025', value: 150 },
      { label: '2026', value: 80 }
    ]);
  });

  it('buildStats 的 costTrend 在月区间下按日给点（不再只有一根柱）', () => {
    const a = car('A', 'A 车', 'fuel');
    const costs = [
      cost('c1', 'A', 'cat:park', 100, 2026, 3, 3),
      cost('c2', 'A', 'cat:park', 60, 2026, 3, 9)
    ];
    const snap = buildStats({ type: 'month', year: 2026, month: 3 }, costs as any, [], [], CATEGORIES as any, a);
    expect(snap.trendGranularity).toBe('day');
    expect(snap.costTrend).toEqual([
      { label: '3', value: 100 },
      { label: '9', value: 60 }
    ]);
  });
});

describe('全车汇总 buildSummary', () => {
  const cars = [car('A', '我的 CRV', 'fuel', 11000), car('B', '小鹏 P7', 'ev', 21000)];
  const costs = [
    cost('c1', 'A', 'cat:park', 200, 2026, 3, 3),
    cost('c2', 'A', 'cat:park', 100, 2026, 3, 3),
    cost('c3', 'A', 'cat:fuel', 312, 2026, 3, 10, 'f1'), // 联动油费
    cost('c4', 'B', 'cat:park', 100, 2026, 3, 5),
    // 区间外（2 月）
    cost('c5', 'A', 'cat:park', 999, 2026, 2, 10)
  ];
  const refuels = [
    refuel('f1', 'A', 10000, 2026, 3, 1),
    refuel('f2', 'A', 10500, 2026, 3, 20),
    refuel('f3', 'B', 20000, 2026, 3, 2, 'ev'),
    refuel('f4', 'B', 20500, 2026, 3, 18, 'ev')
  ];

  const snap = buildSummary({ type: 'month', year: 2026, month: 3 }, costs as any, refuels as any, [], CATEGORIES as any, cars as any);

  it('合计支出只算区间内', () => {
    expect(snap.expense.total).toBe(712); // 200+100+312+100
  });

  it('有效里程 = 各车首尾差之和', () => {
    expect(snap.mileageIncreased).toBe(1000); // 500 + 500
  });

  it('每公里 = 全部支出 ÷ 全部里程（不是某辆车的）', () => {
    expect(snap.expense.perKm).toBe(0.712);
    // 去掉油费 312 → 400 / 1000
    expect(snap.expense.perKmExEnergy).toBe(0.4);
    expect(snap.expense.energyTotal).toBe(312);
  });

  it('分类合并后百分比合计 100', () => {
    const sum = snap.categories.reduce((s, c) => s + c.percent, 0);
    expect(Math.round(sum)).toBe(100);
    expect(snap.categories[0].name).toBe('停车');
    expect(snap.categories[0].amount).toBe(400);
  });

  it('各车明细按支出降序，且带各自的能耗口径', () => {
    expect(snap.cars.map(c => c.name)).toEqual(['我的 CRV', '小鹏 P7']);
    expect(snap.cars[0].totalExpense).toBe(612);
    expect(snap.cars[0].consumptionUnit).toBe('L/100km');
    expect(snap.cars[1].consumptionUnit).toBe('kWh/100km');
  });

  it('趋势粒度与区间一致（月 → 日）', () => {
    expect(snap.trendGranularity).toBe('day');
    // 3/3 合并 300、3/5 100、3/10 312
    expect(snap.costTrend).toEqual([
      { label: '3', value: 300 },
      { label: '5', value: 100 },
      { label: '10', value: 312 }
    ]);
  });
});

describe('自定义区间（最近半个月 / 国庆那几天）', () => {
  const start = new Date(2026, 9, 1).getTime();
  const end = new Date(2026, 9, 7).getTime();

  it('区间含首尾两天：起点归零、终点取当天 23:59', () => {
    const r = resolveRange({ type: 'custom', start, end });
    expect(new Date(r.start).getDate()).toBe(1);
    expect(new Date(r.start).getHours()).toBe(0);
    expect(new Date(r.end).getDate()).toBe(7);
    expect(new Date(r.end).getHours()).toBe(23);
  });

  it('跨度 ≤62 天按日看，更长按月看', () => {
    expect(trendGranularityOf({ type: 'custom', start, end })).toBe('day');
    const longEnd = new Date(2026, 9, 1).getTime();
    const longStart = new Date(2026, 5, 1).getTime();
    expect(trendGranularityOf({ type: 'custom', start: longStart, end: longEnd })).toBe('month');
  });

  it('自定义区间的日标签带月份（否则 9/3 与 10/3 会合并）', () => {
    const list = [
      cost('c1', 'A', 'cat:park', 10, 2026, 9, 3),
      cost('c2', 'A', 'cat:park', 20, 2026, 10, 3)
    ];
    const points = groupByGranularity(list, (x: any) => x.costDate, (x: any) => x.amount, 'day', true);
    expect(points.map(p => p.label)).toEqual(['9/3', '10/3']);
  });

  it('汇总只统计区间内的记录', () => {
    const cars = [car('A', '我的 CRV', 'fuel', 11000)];
    const costs = [
      cost('in1', 'A', 'cat:park', 100, 2026, 10, 2),
      cost('in2', 'A', 'cat:park', 50, 2026, 10, 7),
      cost('out1', 'A', 'cat:park', 999, 2026, 10, 8)
    ];
    const snap = buildSummary({ type: 'custom', start, end }, costs as any, [], [], CATEGORIES as any, cars as any);
    expect(snap.expense.total).toBe(150);
    expect(snap.trendGranularity).toBe('day');
    expect(snap.costTrend.map(p => p.label)).toEqual(['10/2', '10/7']);
  });
});

describe('分类支出带笔数', () => {
  it('同一分类多笔会合并金额并累计笔数', () => {
    const cars = [car('A', '我的 CRV', 'fuel', 11000)];
    const costs = [
      cost('p1', 'A', 'cat:park', 15, 2026, 3, 3),
      cost('p2', 'A', 'cat:park', 18, 2026, 3, 8),
      cost('p3', 'A', 'cat:fuel', 300, 2026, 3, 10)
    ];
    const snap = buildSummary({ type: 'month', year: 2026, month: 3 }, costs as any, [], [], CATEGORIES as any, cars as any);
    const park = snap.categories.find(c => c.name === '停车')!;
    expect(park.amount).toBe(33);
    expect(park.count).toBe(2);
  });

  it('单车统计也返回笔数（统计页与总览口径一致）', () => {
    const a = car('A', 'A 车', 'fuel');
    const costs = [
      cost('p1', 'A', 'cat:park', 10, 2026, 3, 3),
      cost('p2', 'A', 'cat:park', 10, 2026, 3, 4)
    ];
    const snap = buildStats({ type: 'month', year: 2026, month: 3 }, costs as any, [], [], CATEGORIES as any, a);
    expect(snap.categories[0].count).toBe(2);
  });
});
