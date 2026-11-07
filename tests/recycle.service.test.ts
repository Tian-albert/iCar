// 回收站单测：批次撤销、车辆级联删除、30 天过期清理（R-02 / R-03）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, getCar } from '../services/car.service';
import { saveRefuel, listRefuels, removeRefuel } from '../services/refuel.service';
import { saveRepair, listRepairs } from '../services/repair.service';
import {
  listRecycleBatches,
  restoreBatch,
  purgeExpired,
  deleteCarCascade,
  RETENTION_DAYS
} from '../services/recycle.service';

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

function addRefuel(adapter: StorageAdapter, carId: string, km: number) {
  return saveRefuel(adapter, {
    carSourceId: carId,
    fuelDate: Date.now(),
    makeMileages: km,
    unitPrice: 7.5,
    volume: 40,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false
  });
}

describe('recycle.service 单条删除撤销', () => {
  it('删除加油记录后整批恢复，关联支出同步恢复', () => {
    const { adapter, car } = setup();
    const log = addRefuel(adapter, car.sourceId, 100);
    removeRefuel(adapter, log.sourceId);
    expect(listRefuels(adapter, car.sourceId).length).toBe(0);

    const batches = listRecycleBatches(adapter);
    expect(batches.length).toBe(1);
    expect(batches[0].count).toBe(2); // 加油记录 + 关联支出
    expect(batches[0].refs.some(r => r.table === 'costs')).toBe(true);

    expect(restoreBatch(adapter, batches[0].batch)).toBe(true);
    expect(listRefuels(adapter, car.sourceId).length).toBe(1);
    expect(adapter.get<any>('costs', log.costSourceId)!.deleted).toBe(false);
    expect(listRecycleBatches(adapter).length).toBe(0);
  });
});

describe('recycle.service 车辆级联删除', () => {
  it('车辆及名下全部记录一起删除，可整批恢复', () => {
    const { adapter, car } = setup();
    addRefuel(adapter, car.sourceId, 100);
    saveRepair(adapter, {
      carSourceId: car.sourceId,
      content: '换刹车片',
      mileage: 200,
      repairDate: Date.now(),
      amount: 300
    });

    expect(deleteCarCascade(adapter, car.sourceId)).toBe(true);
    expect(getCar(adapter, car.sourceId)).toBeNull();
    expect(listRefuels(adapter, car.sourceId).length).toBe(0);
    expect(listRepairs(adapter, car.sourceId).length).toBe(0);

    const batch = listRecycleBatches(adapter).find(b => b.title.startsWith('车辆'));
    expect(batch).toBeDefined();
    expect(batch!.count).toBeGreaterThan(2);

    expect(restoreBatch(adapter, batch!.batch)).toBe(true);
    expect(getCar(adapter, car.sourceId)).not.toBeNull();
    expect(listRefuels(adapter, car.sourceId).length).toBe(1);
    expect(listRepairs(adapter, car.sourceId).length).toBe(1);
  });
});

describe('recycle.service 过期清理', () => {
  it('超过 30 天的软删记录被物理清理，未过期的保留', () => {
    const { adapter, car } = setup();
    const oldLog = addRefuel(adapter, car.sourceId, 100);
    const newLog = addRefuel(adapter, car.sourceId, 200);
    removeRefuel(adapter, oldLog.sourceId);
    removeRefuel(adapter, newLog.sourceId);

    const expired = Date.now() - (RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
    for (const e of adapter.list<any>('fuelRecords')) {
      if (e.sourceId === oldLog.sourceId) {
        e.deletedAt = expired;
        adapter.update('fuelRecords', e);
      }
    }
    for (const e of adapter.list<any>('costs')) {
      if (e.deleted && e.fuelRecordSourceId === oldLog.sourceId) {
        e.deletedAt = expired;
        adapter.update('costs', e);
      }
    }

    expect(purgeExpired(adapter)).toBe(2);
    expect(adapter.get<any>('fuelRecords', oldLog.sourceId)).toBeNull();
    expect(adapter.get<any>('fuelRecords', newLog.sourceId)!.deleted).toBe(true);
  });
});
