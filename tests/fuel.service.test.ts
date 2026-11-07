import {
  computeShouldPay,
  rebuildConsumptions,
  summarizeConsumptions,
  buildConsumption,
  MAX_FUEL_CONSUMPTION
} from '../domain/fuel.service';
import { sample } from './fixtures/sample';
import { RefuelLog } from '../types/models';

describe('fuel.service 金额联动', () => {
  it('应付金额 = 单价 × 加油量，保留 2 位', () => {
    expect(computeShouldPay(8.63, 47.02)).toBe(405.78);
    expect(computeShouldPay(7.79, 50)).toBe(389.5);
  });
});

describe('fuel.service 油耗区间（样本 10 条）', () => {
  const logs = [...sample.fuelRecords].sort((a, b) => a.fuelDate - b.fuelDate);
  const segs = rebuildConsumptions(logs);

  it('生成 6 个区间', () => {
    expect(segs.length).toBe(6);
  });

  it('Σ区间里程 = 1791，Σ油耗量 = 145.68，平均油耗 8.13', () => {
    const s = summarizeConsumptions(segs);
    expect(s.mileage).toBe(1791);
    expect(s.fuelAmount).toBeCloseTo(145.68, 2);
    expect(s.avgConsumption).toBeCloseTo(8.13, 2);
    expect(s.costPerKm).toBeCloseTo(0.63, 2);
  });

  it('最近区间 = 3.06 L/100km / 188km / 0.26 元/km', () => {
    const last = segs[segs.length - 1];
    expect(last.mileage).toBe(188);
    expect(last.fuelConsumption).toBeCloseTo(3.06, 2);
    expect(last.cost).toBeCloseTo(49.62, 2);
    expect(last.costPerKm).toBeCloseTo(0.26, 2);
  });

  it('S 加满 + E 未加满 → 区间不成立', () => {
    const s = logs.find(l => l.makeMileages === 2178)!; // 09-19 加满
    const e = logs.find(l => l.makeMileages === 2720)!; // 10-07 未加满
    expect(buildConsumption(s, e)).toBeNull();
  });

  it('S 未加满且非低油量 + E 加满 → 区间不成立', () => {
    const s = logs.find(l => l.makeMileages === 480)!; // 05-30 未加满非低
    const e = logs.find(l => l.makeMileages === 575)!; // 06-13 加满
    expect(buildConsumption(s, e)).toBeNull();
  });

  it('删除中间一条（2026-08-23）后重新配对：区间数变 5，且 (07-31→08-28)=456km/15L', () => {
    const deleted = 'mp:refuel-log:6a8a85685d732f70fce60cda'; // 08-23, 1620km
    const remaining = logs.filter(l => l.sourceId !== deleted) as RefuelLog[];
    const segs2 = rebuildConsumptions(remaining);
    expect(segs2.length).toBe(5);

    const pair = segs2.find(
      c => c.startFuelRecordSourceId === 'mp:refuel-log:6a7428cc5b66f43e592dd0da' && // 07-31
           c.endFuelRecordSourceId === 'mp:refuel-log:6a91a15ecfbac0cba8befd7b'        // 08-28
    );
    expect(pair).toBeDefined();
    expect(pair!.mileage).toBe(456);
    expect(pair!.fuelAmount).toBeCloseTo(15, 3);
  });
});

describe('fuel.service 异常油耗收敛（F-07）', () => {
  it('1km 区间的荒谬油耗被限制在 MAX_FUEL_CONSUMPTION', () => {
    const start = {
      ...sample.fuelRecords[0],
      makeMileages: 100,
      isFull: true,
      isLowFuel: false,
      volume: 50,
      actualPayAmount: 300
    } as RefuelLog;
    const end = {
      ...sample.fuelRecords[1],
      makeMileages: 101,
      isFull: true,
      isLowFuel: false,
      volume: 50,
      actualPayAmount: 300
    } as RefuelLog;

    const seg = buildConsumption(start, end);
    expect(seg).not.toBeNull();
    expect(seg!.mileage).toBe(1);
    expect(seg!.fuelConsumption).toBe(MAX_FUEL_CONSUMPTION);
  });

  it('正常区间油耗不受收敛影响', () => {
    const segs = rebuildConsumptions(
      [...sample.fuelRecords].sort((a, b) => a.fuelDate - b.fuelDate)
    );
    expect(segs.every(s => s.fuelConsumption <= MAX_FUEL_CONSUMPTION)).toBe(true);
    const last = segs[segs.length - 1];
    expect(last.fuelConsumption).toBeCloseTo(3.06, 2);
  });
});

describe('fuel.service 汇总口径一致性（审查发现）', () => {
  const mkLog = (mileage: number, volume: number): RefuelLog =>
    ({
      ...sample.fuelRecords[0],
      sourceId: `mp:refuel-log:review-${mileage}-${volume}`,
      makeMileages: mileage,
      volume,
      isFull: true,
      isLowFuel: false,
      actualPayAmount: 300
    } as RefuelLog);

  it('异常区间不把汇总平均油耗拉到上限之外', () => {
    const normal = buildConsumption(mkLog(0, 20), mkLog(200, 20))!;
    const abnormal = buildConsumption(mkLog(200, 1), mkLog(201, 50))!;
    expect(normal.fuelConsumption).toBeCloseTo(10, 2);
    expect(abnormal.fuelConsumption).toBe(MAX_FUEL_CONSUMPTION);

    // 汇总按 (Σ油耗量 / Σ里程) 独立重算，也必须遵守同一上限
    const summary = summarizeConsumptions([normal, abnormal]);
    expect(summary.avgConsumption).toBeLessThanOrEqual(MAX_FUEL_CONSUMPTION);
  });
});
