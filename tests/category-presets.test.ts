// 预设类别改造：支出类别与系统类别分离
//
// 背景：加油/充电/保养/维修 有专用录入表单，会自动生成支出记录。
// 如果它们还出现在「记一笔 → 支出」的类别里，用户会把同一笔消费记两遍。
// 因此把它们转为「系统预设」——保留数据（自动归类依赖 presetType），
// 但从支出选择与类别管理中隐藏。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories, isSystemPreset } from '../repositories/seed';
import {
  listSpendCategories,
  listCategories,
  hasCategoryName,
  setCategoryIcon,
  getCategory,
  moveCategoryBy
} from '../services/cost.service';
import { Category, Cost } from '../types/models';

const fsx = require('fs') as any;

function memory(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

function setup() {
  const adapter = new StorageAdapter(memory());
  seedPresetCategories(adapter);
  return adapter;
}

function cat(partial: Partial<Category> & { sourceId: string; name: string }): Category {
  const now = Date.now();
  return {
    sourcePlatform: 'mp',
    icon: '🧾',
    isPreset: true,
    presetType: '',
    visible: true,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    ...partial
  } as Category;
}

function costOf(categorySourceId: string): Cost {
  const now = Date.now();
  return {
    sourceId: `cost-${Math.random().toString(16).slice(2)}`,
    sourcePlatform: 'mp',
    carSourceId: 'car-1',
    categorySourceId,
    amount: 100,
    costDate: now,
    remark: '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  } as Cost;
}

describe('支出类别只包含支出预设', () => {
  it('新库的支出类别恰好是 停车费 / 洗车 / 高速费 / 保险', () => {
    const names = listSpendCategories(setup()).map(c => c.name);
    expect(names).toEqual(['停车费', '洗车', '高速费', '保险']);
  });

  it('支出类别里不出现 加油 / 充电 / 保养 / 维修', () => {
    const names = listSpendCategories(setup()).map(c => c.name);
    for (const banned of ['加油', '充电', '保养', '维修']) {
      expect(names).not.toContain(banned);
    }
  });
});

describe('系统预设必须保留（自动归类依赖 presetType）', () => {
  it('加油/充电/保养/维修 仍在库里且 presetType 正确', () => {
    const s = setup();
    const all = listCategories(s);
    const find = (name: string) => all.find(c => c.name === name);

    expect(find('加油')!.presetType).toBe('refuel');
    expect(find('充电')!.presetType).toBe('ev');
    expect(find('保养')!.presetType).toBe('maintain');
    expect(find('维修')!.presetType).toBe('fix');
  });

  it('isSystemPreset 能正确识别', () => {
    const s = setup();
    const all = listCategories(s);
    expect(isSystemPreset(all.find(c => c.name === '加油')!)).toBe(true);
    expect(isSystemPreset(all.find(c => c.name === '停车费')!)).toBe(false);
  });
});

describe('旧库升级：停车 → 停车费', () => {
  it('改名且保留 sourceId，历史支出仍指向同一类别', () => {
    const adapter = new StorageAdapter(memory());
    adapter.insert(
      'categories',
      cat({ sourceId: 'mp:category:停车', name: '停车', icon: 'p', sortOrder: 3 })
    );
    adapter.insert('costs', costOf('mp:category:停车'));

    seedPresetCategories(adapter);

    const renamed = getCategory(adapter, 'mp:category:停车');
    expect(renamed).toBeTruthy();
    expect(renamed!.name).toBe('停车费');

    // 支出没有丢，仍挂在原 sourceId 上
    const costs = adapter.list<Cost>('costs').filter(c => !c.deleted);
    expect(costs.length).toBe(1);
    expect(costs[0].categorySourceId).toBe('mp:category:停车');
  });

  it('已存在「停车费」时并入它，不产生两个同名类别', () => {
    const adapter = new StorageAdapter(memory());
    adapter.insert(
      'categories',
      cat({ sourceId: 'mp:category:停车', name: '停车', icon: 'p', sortOrder: 3 })
    );
    adapter.insert(
      'categories',
      cat({ sourceId: 'custom-parking-fee', name: '停车费', isPreset: false, icon: '🅿️' })
    );
    adapter.insert('costs', costOf('mp:category:停车'));

    seedPresetCategories(adapter);

    const alive = listCategories(adapter).filter(c => c.name === '停车费');
    expect(alive.length).toBe(1);

    const costs = adapter.list<Cost>('costs').filter(c => !c.deleted);
    expect(costs[0].categorySourceId).toBe('custom-parking-fee');
  });
});

describe('自定义类别不得与预设重名', () => {
  it('与支出预设重名被拦下', () => {
    const s = setup();
    expect(hasCategoryName(s, '洗车')).toBe(true);
    expect(hasCategoryName(s, '高速费')).toBe(true);
  });

  it('与系统预设重名同样被拦下（避免与自动归类撞名）', () => {
    const s = setup();
    expect(hasCategoryName(s, '加油')).toBe(true);
    expect(hasCategoryName(s, '充电')).toBe(true);
  });

  it('大小写与首尾空格不敏感', () => {
    const s = setup();
    expect(hasCategoryName(s, '  洗车  ')).toBe(true);
  });

  it('新名字可用', () => {
    const s = setup();
    expect(hasCategoryName(s, '洗车美容')).toBe(false);
  });
});

describe('预设类别可以更换图标', () => {
  it('setCategoryIcon 对预设生效', () => {
    const s = setup();
    const target = listSpendCategories(s).find(c => c.name === '洗车')!;
    setCategoryIcon(s, target.sourceId, '🧽');
    expect(getCategory(s, target.sourceId)!.icon).toBe('🧽');
  });
});

describe('种子幂等', () => {
  it('连续两次 seed 不产生重复类别', () => {
    const s = setup();
    seedPresetCategories(s);
    seedPresetCategories(s);
    const names = listCategories(s).map(c => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter(n => n === '停车费').length).toBe(1);
  });
});

describe('类别管理页的配套改动', () => {
  const ts: string = fsx.readFileSync('pages/category-manage/index.ts', 'utf-8');

  it('系统预设不展示在本页', () => {
    expect(ts).toContain('isSystemPreset');
    expect(ts).toMatch(/presets:[\s\S]{0,80}!v\.isSystem/);
  });

  it('改名不覆盖用户设置的图标', () => {
    // 之前写死 updateCategory(..., '🧾')，改名会把图标冲掉
    expect(ts).toContain('getCategory');
    expect(ts).not.toMatch(/updateCategory\(getStorage\(\), id, name, '🧾'\)/);
  });
});

describe('复审修复：排序不得与隐藏的系统预设交换', () => {
  it('可见预设下移一位，只与相邻的可见预设交换', () => {
    const s = setup();
    const names = () => listSpendCategories(s).map(c => c.name);
    expect(names()).toEqual(['停车费', '洗车', '高速费', '保险']);

    const insurance = listSpendCategories(s).find(c => c.name === '保险')!;
    expect(moveCategoryBy(s, insurance.sourceId, -1)).toBe(true);

    // 修复前：兄弟集含系统预设，会与看不见的行交换，界面纹丝不动
    expect(names()).toEqual(['停车费', '洗车', '保险', '高速费']);
  });

  it('可见预设上移到底后不再变化（不会挪到系统预设位置）', () => {
    const s = setup();
    const first = listSpendCategories(s)[0];
    expect(moveCategoryBy(s, first.sourceId, -1)).toBe(false);
    expect(listSpendCategories(s).map(c => c.name)).toEqual([
      '停车费',
      '洗车',
      '高速费',
      '保险'
    ]);
  });

  it('最后一个可见预设继续下移应返回 false（不能与隐藏的系统预设交换）', () => {
    const s = setup();
    const last = listSpendCategories(s)[3];
    expect(last.name).toBe('保险');

    // 修复前：兄弟集含系统预设，会与「加油」交换 → 返回 true 但界面纹丝不动
    expect(moveCategoryBy(s, last.sourceId, 1)).toBe(false);
    expect(listSpendCategories(s).map(c => c.name)).toEqual([
      '停车费',
      '洗车',
      '高速费',
      '保险'
    ]);
  });

  it('系统预设自身的 sortOrder 不被可见预设的重排改动', () => {
    const s = setup();
    const fuelBefore = listCategories(s).find(c => c.name === '加油')!.sortOrder;
    const insurance = listSpendCategories(s).find(c => c.name === '保险')!;
    moveCategoryBy(s, insurance.sourceId, -2);
    expect(listCategories(s).find(c => c.name === '加油')!.sortOrder).toBe(fuelBefore);
  });
});

describe('复审修复：同名自定义类别要升级为系统预设', () => {
  it('库里已有自定义「加油」时，升级为 presetType=refuel（否则保存加油会抛错）', () => {
    const adapter = new StorageAdapter(memory());
    adapter.insert(
      'categories',
      cat({ sourceId: 'custom-fuel', name: '加油', isPreset: false, icon: '⛽' })
    );

    seedPresetCategories(adapter);

    const fuel = listCategories(adapter).find(c => c.name === '加油')!;
    expect(fuel.isPreset).toBe(true);
    expect(fuel.presetType).toBe('refuel');
    // 不产生第二条同名类别
    expect(listCategories(adapter).filter(c => c.name === '加油').length).toBe(1);
  });

  it('同名自定义「洗车」则让位给用户（不强制升级为支出预设）', () => {
    const adapter = new StorageAdapter(memory());
    adapter.insert(
      'categories',
      cat({ sourceId: 'custom-wash', name: '洗车', isPreset: false, icon: '🧽' })
    );

    seedPresetCategories(adapter);

    const wash = listCategories(adapter).filter(c => c.name === '洗车');
    expect(wash.length).toBe(1);
    expect(wash[0].isPreset).toBe(false);
  });
});

describe('复审修复：编辑支出时不得改选系统预设', () => {
  const ts: string = fsx.readFileSync('pages/cost-form/index.ts', 'utf-8');

  it('新建与编辑都只提供支出类别', () => {
    // 修复前编辑态用 listCategories（全量），可把手工支出改成「加油」
    expect(ts).not.toMatch(/recordId\s*\?\s*listCategories\(storage\)/);
    expect(ts).toContain('listSpendCategories(storage)');
  });

  it('原类别若已隐藏或是系统预设，仍要补进候选（否则被判为不可用而锁死）', () => {
    expect(ts).toContain('getCategory');
    expect(ts).toMatch(/base\.concat\(\[original\]\)/);
  });
});
