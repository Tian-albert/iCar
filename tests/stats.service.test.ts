import { buildStats } from '../domain/stats.service';
import { rebuildConsumptions, buildConsumption, MAX_FUEL_CONSUMPTION } from '../domain/fuel.service';
import { sample, sampleCar } from './fixtures/sample';
import { RefuelLog } from '../types/models';

describe('stats.service buildStats（维度=全部，样本数据）', () => {
  const segs = rebuildConsumptions(sample.fuelRecords);
  const snap = buildStats(
    { type: 'all' },
    sample.costs,
    sample.fuelRecords,
    segs,
    sample.categories,
    sampleCar
  );

  it('里程：2908 / 2892 / 1791', () => {
    expect(snap.mileage.latest).toBe(2908);
    expect(snap.mileage.increased).toBe(2892);
    expect(snap.mileage.fuelMileage).toBe(1791);
  });

  it('油耗：2359.22 / 8.13 / 1.317', () => {
    expect(snap.fuel.totalCost).toBeCloseTo(2359.22, 2);
    expect(snap.fuel.avgConsumption).toBeCloseTo(8.13, 2);
    expect(snap.fuel.costPerKm).toBeCloseTo(1.317, 3);
  });

  it('支出：3529.90 / 1.221 / 0.405', () => {
    expect(snap.expense.total).toBeCloseTo(3529.9, 2);
    expect(snap.expense.perKm).toBeCloseTo(1.221, 3);
    expect(snap.expense.perKmExFuel).toBeCloseTo(0.405, 3);
  });

  it('分类支出占比合计 = 100.00，加油占比 66.84', () => {
    const sum = snap.categories.reduce((s, c) => s + c.percent, 0);
    expect(sum).toBeCloseTo(100, 2);

    const fuel = snap.categories.find(c => c.name === '加油');
    expect(fuel).toBeDefined();
    expect(fuel!.amount).toBeCloseTo(2359.22, 2);
    expect(fuel!.percent).toBeCloseTo(66.84, 2);
  });

  it('月度行程：7月769 / 8月456 / 9月378 / 10月188', () => {
    expect(snap.monthlyMileage).toEqual([
      { label: '7月', value: 769 },
      { label: '8月', value: 456 },
      { label: '9月', value: 378 },
      { label: '10月', value: 188 }
    ]);
  });

  it('月度费用：合计 3529.90，8月 1215.57', () => {
    const sum = snap.monthlyCost.reduce((s, c) => s + c.value, 0);
    expect(sum).toBeCloseTo(3529.9, 2);
    const aug = snap.monthlyCost.find(c => c.label === '8月');
    expect(aug!.value).toBeCloseTo(1215.57, 2);
  });

  it('有效区间 < 2 时趋势降级（数据不足）', () => {
    const one = buildStats({ type: 'all' }, [], sample.fuelRecords.slice(0, 1), [], sample.categories, sampleCar);
    expect(one.consumptionTrend.length).toBeLessThan(2);
  });
});

describe('stats.service 异常油耗口径（审查发现）', () => {
  it('年平均油耗与趋势图受同一上限约束，不出现荒谬值', () => {
    const start = {
      ...sample.fuelRecords[0],
      makeMileages: 0,
      volume: 20,
      isFull: true,
      isLowFuel: false
    } as RefuelLog;
    const end = {
      ...sample.fuelRecords[1],
      makeMileages: 1,
      volume: 50,
      isFull: true,
      isLowFuel: false
    } as RefuelLog;
    const segs = [buildConsumption(start, end)!];
    const snap = buildStats({ type: 'all' }, [], [start, end], segs, sample.categories, sampleCar);

    expect(segs[0].fuelConsumption).toBe(MAX_FUEL_CONSUMPTION);
    expect(snap.consumptionTrend[0].value).toBe(MAX_FUEL_CONSUMPTION);
    expect(snap.fuel.avgConsumption).toBeLessThanOrEqual(MAX_FUEL_CONSUMPTION);
  });
});
