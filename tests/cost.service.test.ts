// 支出服务单测：记支出 + 类别管理（预设只读、有流水不可删）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import {
  saveCost,
  listCosts,
  listCategories,
  listSpendCategories,
  addCategory,
  removeCategory,
  setCategoryVisible
} from '../services/cost.service';

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

describe('cost.service 记支出', () => {
  it('保存支出并可按车查询', () => {
    const { adapter, car } = setup();
    const fuelCat = listCategories(adapter).find(c => c.presetType === 'refuel')!;
    saveCost(adapter, {
      carSourceId: car.sourceId,
      categorySourceId: fuelCat.sourceId,
      amount: 189,
      costDate: Date.now(),
      remark: '高速路费'
    });
    const costs = listCosts(adapter, car.sourceId);
    expect(costs.length).toBe(1);
    expect(costs[0].amount).toBe(189);
    expect(costs[0].remark).toBe('高速路费');
  });
});

describe('cost.service 类别管理', () => {
  it('预设类别不可删除', () => {
    const { adapter } = setup();
    const preset = listCategories(adapter).find(c => c.isPreset)!;
    const r = removeCategory(adapter, preset.sourceId);
    expect(r.ok).toBe(false);
  });

  it('自定义类别：空可删，有支出则拒绝', () => {
    const { adapter, car } = setup();
    const cat = addCategory(adapter, '停车费', 'p');

    // 有支出后不可删
    saveCost(adapter, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 32,
      costDate: Date.now()
    });
    const blocked = removeCategory(adapter, cat.sourceId);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain('1 条支出记录');
  });

  it('自定义类别：无支出可删除（软删）', () => {
    const { adapter } = setup();
    const cat = addCategory(adapter, '杂费', 'ticket');
    const r = removeCategory(adapter, cat.sourceId);
    expect(r.ok).toBe(true);
    expect(listCategories(adapter).some(c => c.sourceId === cat.sourceId)).toBe(false);
  });

  it('记支出默认显示全部类别（4 预设 + 自定义）', () => {
    const { adapter } = setup();
    addCategory(adapter, '杂费', 'ticket');
    const names = listSpendCategories(adapter).map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['加油', '保养', '维修', '停车', '杂费']));
  });

  it('关闭某类别的"显示"后，记支出不再出现该类别', () => {
    const { adapter } = setup();
    const fuel = listCategories(adapter).find(c => c.name === '加油')!;
    setCategoryVisible(adapter, fuel.sourceId, false);
    const names = listSpendCategories(adapter).map(c => c.name);
    expect(names).not.toContain('加油');
    expect(names).toContain('保养');
  });
});
