// 上线前全面审计的修复回归测试（2026-11-08）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveRefuel, listRefuels } from '../services/refuel.service';
import { listCosts } from '../services/cost.service';
import { listMaintains, addMaintain } from '../services/maintain-record.service';
import { buildStats } from '../domain/stats.service';
import { MAX_EV_CONSUMPTION, rebuildConsumptionsGrouped } from '../domain/fuel.service';
import { importBundle } from '../services/io.service';
import { monthLabelWithYear } from '../utils/date';
import { EnergyType } from '../types/models';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function setup(energyType: EnergyType = 'fuel') {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: '测试车',
    mileages: 0,
    initDate: Date.now(),
    energyType
  });
  return { adapter, car };
}

function record(
  adapter: StorageAdapter,
  carId: string,
  km: number,
  amount: number,
  energyType: 'fuel' | 'ev',
  date?: number
) {
  return saveRefuel(adapter, {
    carSourceId: carId,
    fuelDate: date ?? new Date(2026, 4, 1).getTime() + km * 1000,
    makeMileages: km,
    unitPrice: 1,
    volume: amount,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType
  });
}

describe('审计修复：纯电车统计页里程不为 0', () => {
  it('纯电车 fuelMileage 为 0，但 evMileage 有值（页面据此取值）', () => {
    const { adapter, car } = setup('ev');
    record(adapter, car.sourceId, 100, 20, 'ev');
    record(adapter, car.sourceId, 600, 20, 'ev');

    const snap = buildStats(
      { type: 'all' },
      listCosts(adapter, car.sourceId),
      listRefuels(adapter, car.sourceId),
      rebuildConsumptionsGrouped(listRefuels(adapter, car.sourceId)),
      [],
      car
    );
    // 页面修复前固定取 fuelMileage → 恒为 0
    expect(snap.mileage.fuelMileage).toBe(0);
    expect(snap.mileage.evMileage).toBe(500);
  });
});

describe('审计修复：电耗上限独立于油耗', () => {
  it('高电耗不被截断到 30', () => {
    const { adapter, car } = setup('ev');
    // 锚点 100km 充满后，600km 再充满时补入 200kWh → 200/500*100 = 40 kWh/100km
    record(adapter, car.sourceId, 100, 0, 'ev');
    record(adapter, car.sourceId, 600, 200, 'ev');

    const snap = buildStats(
      { type: 'all' },
      listCosts(adapter, car.sourceId),
      listRefuels(adapter, car.sourceId),
      rebuildConsumptionsGrouped(listRefuels(adapter, car.sourceId)),
      [],
      car
    );
    expect(snap.electricity.avgConsumption).toBe(40);
    expect(snap.electricity.avgConsumption).toBeLessThanOrEqual(MAX_EV_CONSUMPTION);
  });
});

describe('审计修复：跨年月份标签不合并', () => {
  it('跨年时标签带年份，单年内保持短标签', () => {
    const y2025 = new Date(2025, 6, 15).getTime();
    const y2026 = new Date(2026, 6, 15).getTime();
    expect(monthLabelWithYear(y2025)).toBe('2025/7');
    expect(monthLabelWithYear(y2026)).toBe('2026/7');
    expect(monthLabelWithYear(y2025)).not.toBe(monthLabelWithYear(y2026));
  });

  it('buildStats 在跨年数据下产生 2 个不同的月度点', () => {
    const { adapter, car } = setup('fuel');
    record(adapter, car.sourceId, 100, 40, 'fuel', new Date(2025, 6, 1).getTime());
    record(adapter, car.sourceId, 600, 40, 'fuel', new Date(2025, 6, 20).getTime());
    record(adapter, car.sourceId, 1100, 40, 'fuel', new Date(2026, 6, 1).getTime());
    record(adapter, car.sourceId, 1600, 40, 'fuel', new Date(2026, 6, 20).getTime());

    const snap = buildStats(
      { type: 'all' },
      listCosts(adapter, car.sourceId),
      listRefuels(adapter, car.sourceId),
      rebuildConsumptionsGrouped(listRefuels(adapter, car.sourceId)),
      [],
      car
    );
    const labels = snap.monthlyMileage.map(m => m.label);
    expect(labels.length).toBe(2);
    expect(labels).toEqual(expect.arrayContaining(['2025/7', '2026/7']));
  });
});

describe('审计修复：导入数值净化', () => {
  const manifest = (data: Record<string, unknown>) =>
    JSON.stringify({ format: 'icar-export', version: 1, data });

  it('NaN / 负数金额与里程被兜底，不污染统计', () => {
    const { adapter } = setup('fuel');
    const json = manifest({
      costs: [
        {
          sourceId: 'mp:costs:nan',
          carSourceId: 'mp:cars:x',
          categorySourceId: 'mp:category:加油',
          amount: NaN,
          costDate: Date.now(),
          createdAt: 1,
          updatedAt: 9999999999999
        }
      ],
      fuelRecords: [
        {
          sourceId: 'mp:refuel-log:neg',
          carSourceId: 'mp:cars:x',
          energyType: 'weird',
          makeMileages: -5,
          unitPrice: -1,
          volume: NaN,
          actualPayAmount: -100,
          createdAt: 1,
          updatedAt: 9999999999999
        }
      ]
    });

    const result = importBundle(adapter, json);
    expect(result.ok).toBe(true);

    const cost = adapter.get<any>('costs', 'mp:costs:nan')!;
    expect(cost.amount).toBe(0);
    expect(Number.isFinite(cost.amount)).toBe(true);

    const log = adapter.get<any>('fuelRecords', 'mp:refuel-log:neg')!;
    expect(log.makeMileages).toBe(0);
    expect(log.unitPrice).toBe(0);
    expect(log.volume).toBe(0);
    expect(log.actualPayAmount).toBe(0);
    // 非法能量类型回退 fuel，避免进入分组统计时丢失
    expect(log.energyType).toBe('fuel');
  });

  it('导入的 deleted 记录仍然被跳过（原有行为不回退）', () => {
    const { adapter } = setup('fuel');
    const json = manifest({
      costs: [
        { sourceId: 'mp:costs:gone', amount: 100, deleted: true, updatedAt: 9999999999999 }
      ]
    });
    const result = importBundle(adapter, json);
    expect(result.ok).toBe(true);
    expect(adapter.get<any>('costs', 'mp:costs:gone')).toBeNull();
  });
});

describe('审计修复：保养项排序稳定', () => {
  it('新增项按 createdAt 保持插入顺序，不依赖索引字典序', () => {
    const { adapter, car } = setup('fuel');
    const a = addMaintain(adapter, car.sourceId, {
      name: 'AAA项',
      cycleMileages: 1000,
      timeUnit: '',
      timeValue: 0
    });
    const b = addMaintain(adapter, car.sourceId, {
      name: 'ZZZ项',
      cycleMileages: 1000,
      timeUnit: '',
      timeValue: 0
    });
    // 两者 sortOrder 都是 0，必须靠 createdAt 稳定排序
    const ids = listMaintains(adapter, car.sourceId).map(m => m.sourceId);
    const idxA = ids.indexOf(a.sourceId);
    const idxB = ids.indexOf(b.sourceId);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeLessThan(idxB);
  });
});

describe('审计修复：expensePerKmExFuel 不为负', () => {
  it('油费超过总支出时钳到 0', () => {
    const { adapter, car } = setup('fuel');
    record(adapter, car.sourceId, 100, 40, 'fuel');
    record(adapter, car.sourceId, 600, 40, 'fuel');

    // 人为制造「有加油记录但关联 cost 未计入 totalCost」的状态
    const refuels = listRefuels(adapter, car.sourceId);
    const snap = buildStats(
      { type: 'all' },
      [], // 不含任何 cost
      refuels,
      rebuildConsumptionsGrouped(refuels),
      [],
      car
    );
    expect(snap.expense.perKmExFuel).toBeGreaterThanOrEqual(0);
    expect(snap.expense.total).toBe(0);
  });
});
