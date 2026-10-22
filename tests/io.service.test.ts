// 数据导入导出单测：往返无损 + 合并
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, getCar } from '../services/car.service';
import { saveRefuel, listRefuels } from '../services/refuel.service';
import { exportBundle, importBundle } from '../services/io.service';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

describe('io.service 导出导入', () => {
  it('导出后导入到空库：数据往返无损，区间与里程重算', () => {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const car = createCar(a, { name: 'CRV', mileages: 575, initDate: Date.now(), energyType: 'fuel' });
    saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 7.79,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: true
    });
    saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 5, 13).getTime(),
      makeMileages: 575,
      unitPrice: 8.37,
      volume: 33.65,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false
    });

    const json = exportBundle(a);

    const b = new StorageAdapter(createMemoryStorage());
    const result = importBundle(b, json);
    expect(result.ok).toBe(true);
    expect(b.list<any>('cars').filter(c => !c.deleted).length).toBe(1);
    expect(listRefuels(b, car.sourceId).length).toBe(2);
    expect(b.list<any>('fuelConsumptions').filter(c => !c.deleted).length).toBe(1);
    expect(getCar(b, car.sourceId)!.mileages).toBe(575);
  });

  it('导入非法 JSON / 非法格式返回失败', () => {
    const b = new StorageAdapter(createMemoryStorage());
    expect(importBundle(b, 'not json').ok).toBe(false);
    expect(importBundle(b, '{"format":"other"}').ok).toBe(false);
  });
});
