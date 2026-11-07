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

  it('R-04 跨未加满累积后生成 7 个区间', () => {
    expect(segs.length).toBe(7);
  });

  it('Σ区间里程 = 2892，Σ油耗量 = 244.56，平均油耗 8.46', () => {
    const s = summarizeConsumptions(segs);
    expect(s.mileage).toBe(2892);
    expect(s.fuelAmount).toBeCloseTo(244.56, 2);
    expect(s.avgConsumption).toBeCloseTo(8.46, 2);
    expect(s.costPerKm).toBeCloseTo(0.68, 2);
  });

  it('最近区间 = 7.23 L/100km / 730km / 0.62 元/km', () => {
    const last = segs[segs.length - 1];
    expect(last.mileage).toBe(730);
    expect(last.fuelConsumption).toBeCloseTo(7.23, 2);
    expect(last.cost).toBeCloseTo(455.4, 2);
    expect(last.costPerKm).toBeCloseTo(0.62, 2);
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

  it('删除中间一条（2026-08-23）后重新配对：区间数变 6，且 (07-31→08-28)=456km/15L', () => {
    const deleted = 'mp:refuel-log:6a8a85685d732f70fce60cda'; // 08-23, 1620km
    const remaining = logs.filter(l => l.sourceId !== deleted) as RefuelLog[];
    const segs2 = rebuildConsumptions(remaining);
    expect(segs2.length).toBe(6);

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
    expect(last.fuelConsumption).toBeCloseTo(7.23, 2);
  });
});

describe('fuel.service 区间规则修订（R-04）', () => {
  const mk = (
    id: string,
    date: number,
    km: number,
    vol: number,
    full: boolean,
    low = false
  ): RefuelLog =>
    ({
      ...sample.fuelRecords[0],
      sourceId: id,
      fuelDate: date,
      makeMileages: km,
      volume: vol,
      shouldPayAmount: vol * 7,
      actualPayAmount: vol * 7,
      isFull: full,
      isLowFuel: low
    } as RefuelLog);

  it('加满 → 未加满 → 加满 合并为一段，里程与油量不丢失', () => {
    const d = new Date(2026, 4, 1).getTime();
    const logs = [
      mk('a', d, 100, 40, true),
      mk('b', d + 86400000, 300, 10, false),
      mk('c', d + 172800000, 600, 35, true)
    ];
    const segs = rebuildConsumptions(logs);
    expect(segs.length).toBe(1);
    expect(segs[0].mileage).toBe(500);
    expect(segs[0].fuelAmount).toBe(45); // 中间未加满的 10L + 终点 35L
    expect(segs[0].cost).toBeCloseTo(45 * 7, 2);
    expect(segs[0].fuelConsumption).toBeCloseTo(9, 2);
  });

  it('同日多次加油按里程稳定排序，不产生负里程区间', () => {
    const d = new Date(2026, 4, 1).getTime();
    const logs = [
      mk('z', d, 500, 30, true),
      mk('a', d, 100, 40, true),
      mk('m', d, 300, 20, true)
    ];
    const segs = rebuildConsumptions(logs);
    expect(segs.length).toBe(2);
    expect(segs.every(s => s.mileage > 0)).toBe(true);
    expect(segs[0].mileage).toBe(200);
    expect(segs[1].mileage).toBe(200);
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
