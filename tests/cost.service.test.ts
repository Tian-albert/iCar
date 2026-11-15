// 支出服务单测：记支出 + 类别管理（预设只读、有流水不可删）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories, dedupePresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { Category } from '../types/models';
import {
  saveCost,
  updateCost,
  listCosts,
  listCategories,
  listSpendCategories,
  addCategory,
  removeCategory,
  setCategoryVisible,
  moveCategory,
  moveCategoryBy,
  resolveCategorySelection,
  hasCategoryName
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
  it('支出预设可以删除，系统预设不可删除', () => {
    const { adapter } = setup();

    // 支出预设与自定义一致：可删（seed 不会重建，见 category-presets.test）
    const spend = listCategories(adapter).find(c => c.isPreset && !c.presetType)!;
    expect(removeCategory(adapter, spend.sourceId).ok).toBe(true);

    // 系统预设保护：它们靠 presetType 承载自动归类
    const sys = listCategories(adapter).find(c => c.presetType)!;
    const r = removeCategory(adapter, sys.sourceId);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('系统分类');
  });

  it('自定义类别：空可删，有支出则拒绝', () => {
    const { adapter, car } = setup();
    // 用一个不与任何预设/曾用名冲突的名字，避免与归并逻辑互相干扰
    const cat = addCategory(adapter, '快递费', 'p');

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

  it('记支出默认显示全部支出类别（4 支出预设 + 自定义）', () => {
    const { adapter } = setup();
    addCategory(adapter, '杂费', 'ticket');
    const names = listSpendCategories(adapter).map(c => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['停车', '高速', '保险', '洗车', '杂费'])
    );
    // 系统预设（加油/充电/保养/维修）有专用录入，不得出现在支出类别里
    for (const banned of ['加油', '充电', '保养', '维修']) {
      expect(names).not.toContain(banned);
    }
  });

  it('关闭某类别的"显示"后，记支出不再出现该类别', () => {
    const { adapter } = setup();
    const wash = listCategories(adapter).find(c => c.name === '洗车')!;
    setCategoryVisible(adapter, wash.sourceId, false);
    const names = listSpendCategories(adapter).map(c => c.name);
    expect(names).not.toContain('洗车');
    expect(names).toContain('停车');
  });
});

describe('cost.service 类别排序', () => {
  it('新增类别接在支出类别末尾，下移/上移可调整顺序', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, '快递费', 'p');
    const b = addCategory(adapter, '过路费', 'ticket');
    // 4 个支出预设占 0-3，新增从 4 开始（同一序列编号）
    expect(a.sortOrder).toBe(4);
    expect(b.sortOrder).toBe(5);

    moveCategory(adapter, a.sourceId, 'down');
    let names = listCategories(adapter)
      .filter(c => !c.isPreset)
      .map(c => c.name);
    expect(names).toEqual(['过路费', '快递费']);

    moveCategory(adapter, a.sourceId, 'up');
    names = listCategories(adapter)
      .filter(c => !c.isPreset)
      .map(c => c.name);
    expect(names).toEqual(['快递费', '过路费']);
  });

  it('支出类别首末项拖动无效果；拖动可跨越预设与自定义', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, '快递费', 'p');
    const spendNames = () =>
      listCategories(adapter)
        .filter(c => !c.presetType)
        .map(c => c.name);

    expect(spendNames()).toEqual(['停车', '高速', '保险', '洗车', '快递费']);

    // 首项上移无效果
    const first = listCategories(adapter).filter(c => !c.presetType)[0];
    expect(moveCategory(adapter, first.sourceId, 'up')).toBe(false);

    // 合并分组后预设与自定义同属一个序列：自定义项上移会与预设交换
    expect(moveCategory(adapter, a.sourceId, 'up')).toBe(true);
    expect(spendNames()).toEqual(['停车', '高速', '保险', '快递费', '洗车']);

    // 末项下移无效果
    const last = listCategories(adapter).filter(c => !c.presetType).slice(-1)[0];
    expect(moveCategory(adapter, last.sourceId, 'down')).toBe(false);
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

describe('F-02 隐藏类别编辑不串类', () => {
  it('resolveCategorySelection：编辑态精确定位，找不到时锁定不回退', () => {
    const cats = [{ sourceId: 'a' }, { sourceId: 'b' }];
    expect(resolveCategorySelection(cats, 'b', true)).toEqual({ selectedIndex: 1, locked: false });
    expect(resolveCategorySelection(cats, 'gone', true)).toEqual({ selectedIndex: -1, locked: true });
    expect(resolveCategorySelection(cats, '', false)).toEqual({ selectedIndex: 0, locked: false });
    expect(resolveCategorySelection([], '', false)).toEqual({ selectedIndex: -1, locked: false });
  });

  it('隐藏类别仍能被全量列表定位，编辑支出后 categorySourceId 不变', () => {
    const { adapter, car } = setup();
    const fuel = listCategories(adapter).find(c => c.presetType === 'refuel')!;
    const cost = saveCost(adapter, {
      carSourceId: car.sourceId,
      categorySourceId: fuel.sourceId,
      amount: 100,
      costDate: Date.now(),
      remark: ''
    });
    setCategoryVisible(adapter, fuel.sourceId, false);

    // 记支出看不到隐藏类别，但编辑态用全量列表可精确定位
    expect(listSpendCategories(adapter).some(c => c.sourceId === fuel.sourceId)).toBe(false);
    const editable = listCategories(adapter);
    const sel = resolveCategorySelection(editable, cost.categorySourceId, true);
    expect(sel.locked).toBe(false);
    expect(editable[sel.selectedIndex].sourceId).toBe(fuel.sourceId);

    updateCost(adapter, cost.sourceId, {
      carSourceId: car.sourceId,
      categorySourceId: editable[sel.selectedIndex].sourceId,
      amount: 120,
      costDate: cost.costDate,
      remark: '改金额'
    });
    const after = listCosts(adapter, car.sourceId)[0];
    expect(after.categorySourceId).toBe(fuel.sourceId);
    expect(after.amount).toBe(120);
  });
});

describe('cost.service 批量拖动换位（R-12）', () => {
  it('一次跨 2 行换位后顺序正确且 sortOrder 连续', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, 'A', 'p');
    addCategory(adapter, 'B', 'p');
    addCategory(adapter, 'C', 'p');

    expect(moveCategoryBy(adapter, a.sourceId, 2)).toBe(true);

    // 命名只看自定义项，但换位发生在整个支出序列内
    const customs = listCategories(adapter).filter(c => !c.isPreset);
    expect(customs.map(c => c.name)).toEqual(['B', 'C', 'A']);

    // 整个支出序列的 sortOrder 连续（0..n-1），不只是自定义那一段
    const spend = listCategories(adapter).filter(c => !c.presetType);
    expect(spend.map(c => c.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('拖到边界外只移动到端点，不产生越界', () => {
    const { adapter } = setup();
    const a = addCategory(adapter, 'A', 'p');
    addCategory(adapter, 'B', 'p');
    expect(moveCategoryBy(adapter, a.sourceId, 99)).toBe(true);
    expect(listCategories(adapter).filter(c => !c.isPreset).map(c => c.name)).toEqual(['B', 'A']);
    expect(moveCategoryBy(adapter, a.sourceId, -99)).toBe(true);
    expect(listCategories(adapter).filter(c => !c.isPreset).map(c => c.name)).toEqual(['A', 'B']);
  });
});

describe('cost.service 同名类别校验（R-10）', () => {
  it('忽略大小写与首尾空格，编辑时排除自身', () => {
    const { adapter } = setup();
    // 用非预设名，避免与预设「停车费」撞名干扰「排除自身」的判断
    const a = addCategory(adapter, '美容', 'p');
    addCategory(adapter, 'Parking', 'p');

    expect(hasCategoryName(adapter, '美容')).toBe(true);
    expect(hasCategoryName(adapter, ' 美容 ')).toBe(true);
    expect(hasCategoryName(adapter, 'parking')).toBe(true);
    expect(hasCategoryName(adapter, '美容', a.sourceId)).toBe(false);
    // 预设名一律占用，自定义不能重名
    expect(hasCategoryName(adapter, '洗车')).toBe(true);
    expect(hasCategoryName(adapter, '打蜡')).toBe(false);
  });
});
