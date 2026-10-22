// 记加油保存流程单测：验证 RefuelLog + Cost + 区间重算 + 里程回写（BR-25/26）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, getCar } from '../services/car.service';
import {
  saveRefuel,
  listRefuels,
  getConsumptions,
  getLatestConsumption,
  updateRefuel,
  removeRefuel
} from '../services/refuel.service';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function setup() {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: 'CRV',
    mileages: 0,
    initDate: Date.now(),
    energyType: 'fuel'
  });
  return { adapter, car };
}

describe('refuel.service 保存流程', () => {
  it('记两笔加满加油 → 生成 1 个区间，回写里程，生成 Cost', () => {
    const { adapter, car } = setup();

    saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 7.79,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: true
    });

    saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 5, 13).getTime(),
      makeMileages: 575,
      unitPrice: 8.37,
      volume: 33.65,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false
    });

    // 两条记录，倒序（最新在前）
    const refuels = listRefuels(adapter, car.sourceId);
    expect(refuels.length).toBe(2);
    expect(refuels[0].makeMileages).toBe(575);

    // 一个区间：16 -> 575，里程 559，油耗量取终点 33.65
    const segs = getConsumptions(adapter, car.sourceId);
    expect(segs.length).toBe(1);
    expect(segs[0].mileage).toBe(559);
    expect(segs[0].fuelAmount).toBeCloseTo(33.65, 3);
    expect(segs[0].fuelConsumption).toBeCloseTo((33.65 / 559) * 100, 2);

    // 车辆里程回写为最大记录里程 575
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(575);

    // 关联支出流水金额 = 实付（第二笔 8.37×33.65 = 281.65）
    const costs = adapter.list<any>('costs').filter(c => !c.deleted);
    expect(costs.length).toBe(2);
    const second = costs.find(c => c.fuelRecordSourceId === refuels[0].sourceId);
    expect(second!.amount).toBeCloseTo(281.65, 2);
  });

  it('实付金额可覆盖应付金额', () => {
    const { adapter, car } = setup();
    const log = saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: Date.now(),
      makeMileages: 100,
      unitPrice: 8.0,
      volume: 10,
      actualPayAmount: 70, // 优惠后实付 70
      isFull: true,
      isLowFuel: false
    });
    expect(log.shouldPayAmount).toBeCloseTo(80, 2);
    expect(log.actualPayAmount).toBeCloseTo(70, 2);
    const costs = adapter.list<any>('costs').filter(c => !c.deleted);
    expect(costs[0].amount).toBeCloseTo(70, 2);
  });
});

describe('refuel.service 编辑与删除', () => {
  it('编辑加油记录：更新金额并联动 Cost、重算区间', () => {
    const { adapter, car } = setup();
    const log = saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 7.79,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: true
    });

    updateRefuel(adapter, log.sourceId, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 8.0,
      volume: 50,
      actualPayAmount: 380,
      isFull: true,
      isLowFuel: false
    });

    const updated = listRefuels(adapter, car.sourceId)[0];
    expect(updated.unitPrice).toBeCloseTo(8, 2);
    expect(updated.actualPayAmount).toBeCloseTo(380, 2);
    // 联动 Cost 金额
    const costs = adapter.list<any>('costs').filter(c => !c.deleted && c.fuelRecordSourceId === log.sourceId);
    expect(costs[0].amount).toBeCloseTo(380, 2);
  });

  it('删除加油记录：软删记录 + 关联 Cost，回写里程', () => {
    const { adapter, car } = setup();
    const log = saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 7.79,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: true
    });

    removeRefuel(adapter, log.sourceId);
    expect(listRefuels(adapter, car.sourceId).length).toBe(0);
    const cost = adapter.get<any>('costs', log.costSourceId);
    expect(cost.deleted).toBe(true);
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(0);
  });
});

describe('refuel.service 备注与「上次加油记了吗」', () => {
  it('remark 与 lastRecorded 落库，并同步到关联支出', () => {
    const { adapter, car } = setup();
    const log = saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 100,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      lastRecorded: false,
      remark: '中石化 92#'
    });
    expect(log.lastRecorded).toBe(false);
    expect(log.remark).toBe('中石化 92#');
    const cost = adapter.get<any>('costs', log.costSourceId);
    expect(cost.remark).toBe('中石化 92#');
  });

  it('编辑时更新 lastRecorded 与 remark', () => {
    const { adapter, car } = setup();
    const log = saveRefuel(adapter, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 100,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false
    });
    expect(log.lastRecorded).toBe(true);

    updateRefuel(adapter, log.sourceId, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 100,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      lastRecorded: false,
      remark: '忘记记上次了'
    });
    const updated = listRefuels(adapter, car.sourceId)[0];
    expect(updated.lastRecorded).toBe(false);
    expect(updated.remark).toBe('忘记记上次了');
  });
});

describe('refuel.service 最近油耗', () => {
  it('返回按区间终点时间最新的一条', () => {
    const { adapter, car } = setup();
    const base = { actualPayAmount: null, isFull: true, isLowFuel: false, remark: '' };
    saveRefuel(adapter, { ...base, carSourceId: car.sourceId, fuelDate: new Date(2026, 4, 24).getTime(), makeMileages: 16, unitPrice: 7.79, volume: 50 });
    saveRefuel(adapter, { ...base, carSourceId: car.sourceId, fuelDate: new Date(2026, 5, 13).getTime(), makeMileages: 575, unitPrice: 8.37, volume: 33.65 });
    saveRefuel(adapter, { ...base, carSourceId: car.sourceId, fuelDate: new Date(2026, 6, 16).getTime(), makeMileages: 861, unitPrice: 7.2, volume: 25.07 });

    const latest = getLatestConsumption(adapter, car.sourceId);
    expect(latest).not.toBeNull();
    expect(latest!.endDate).toBe(new Date(2026, 6, 16).getTime());
    expect(latest!.mileage).toBe(286);
  });

  it('无区间时返回 null', () => {
    const { adapter, car } = setup();
    expect(getLatestConsumption(adapter, car.sourceId)).toBeNull();
  });
});
