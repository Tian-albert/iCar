// 支出服务单测：记支出 + 类别管理（预设只读、有流水不可删）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories, dedupePresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { Category } from '../types/models';
import {
  saveCost,
  listCosts,
  listCategories,
  listSpendCategories,
  addCategory,
  removeCategory,
  setCategoryVisible,
  moveCategory
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

describe('cost.service 类别排序', () => {
  it('自定义类别 sortOrder 递增，下移/上移可调整顺序', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, '停车费', 'p');
    const b = addCategory(adapter, '过路费', 'ticket');
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);

    moveCategory(adapter, a.sourceId, 'down');
    let names = listCategories(adapter)
      .filter(c => !c.isPreset)
      .map(c => c.name);
    expect(names).toEqual(['过路费', '停车费']);

    moveCategory(adapter, a.sourceId, 'up');
    names = listCategories(adapter)
      .filter(c => !c.isPreset)
      .map(c => c.name);
    expect(names).toEqual(['停车费', '过路费']);
  });

  it('首项上移 / 末项下移无效果，预设组不受自定义排序影响', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, '停车费', 'p');
    addCategory(adapter, '过路费', 'ticket');

    moveCategory(adapter, a.sourceId, 'up'); // 已是首项
    const customs = listCategories(adapter).filter(c => !c.isPreset);
    expect(customs[0].name).toBe('停车费');

    // 预设组仍保持 4 个且在前
    const all = listCategories(adapter);
    expect(all.slice(0, 4).every(c => c.isPreset)).toBe(true);
  });
});

describe('seed 同名预设去重', () => {
  it('同名预设合并为一条，支出迁移到保留项', () => {
    const { adapter, car } = setup();
    // 模拟历史数据 / 导入备份产生的重复"加油"预设（sourceId 与固定 id 不同）
    const dup: Category = {
      sourceId: 'mp:category:dup-fuel',
      sourcePlatform: 'mp',
      name: '加油',
      icon: 'oil',
      isPreset: true,
      presetType: 'refuel',
      visible: true,
      sortOrder: 9,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    };
    adapter.insert<Category>('categories', dup);

    expect(listCategories(adapter).filter(c => c.name === '加油' && c.isPreset).length).toBe(2);

    // 在重复项上记一笔支出
    saveCost(adapter, {
      carSourceId: car.sourceId,
      categorySourceId: dup.sourceId,
      amount: 66,
      costDate: Date.now(),
      remark: '停车费'
    });

    dedupePresetCategories(adapter);

    const fuels = listCategories(adapter).filter(c => c.name === '加油' && c.isPreset);
    expect(fuels.length).toBe(1);
    expect(fuels[0].sourceId).toBe('mp:category:加油');

    // 支出已迁移到保留项
    const costs = listCosts(adapter, car.sourceId);
    expect(costs.length).toBe(1);
    expect(costs[0].categorySourceId).toBe('mp:category:加油');
  });
});
