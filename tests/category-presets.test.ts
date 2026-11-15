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
  getCategory
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
