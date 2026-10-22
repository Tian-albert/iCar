// 维修服务单测：填金额 → 生成维修类支出流水（进近期支出）；不填金额 → 仅事件
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveRepair, listRepairs } from '../services/repair.service';
import { listCosts } from '../services/cost.service';

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
  const car = createCar(adapter, { name: 'CRV', mileages: 100, initDate: Date.now(), energyType: 'fuel' });
  return { adapter, car };
}

describe('repair.service 记维修', () => {
  it('填金额 → 生成维修类支出流水，进 listCosts', () => {
    const { adapter, car } = setup();
    saveRepair(adapter, {
      carSourceId: car.sourceId,
      content: '贴窗膜',
      mileage: 2000,
      repairDate: Date.now(),
      amount: 250
    });
    const costs = listCosts(adapter, car.sourceId);
    expect(costs.length).toBe(1);
    expect(costs[0].amount).toBe(250);
    expect(costs[0].repairSourceId).not.toBe('');
  });

  it('不填金额 → 仅记录维修事件，不生成支出', () => {
    const { adapter, car } = setup();
    saveRepair(adapter, {
      carSourceId: car.sourceId,
      content: '质保检测',
      mileage: 2000,
      repairDate: Date.now(),
      amount: null
    });
    expect(listRepairs(adapter, car.sourceId).length).toBe(1);
    expect(listCosts(adapter, car.sourceId).length).toBe(0);
  });
});
