// 收尾修复 5 项：
// 1. 类别合并时回收站里的支出也要改指
// 2. 用户改名后，导入旧备份不再把原名归一化回来
// 3. 内联色值清理（switch / slider / 导航色）
// 4. 测试数据的 sortOrder 与 seed 一致
// 5. 保养选择器 ≤3 项时不开启 scroll-y
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { listCategories, removeCategory, updateCategory, addCategory } from '../services/cost.service';
import { Category, Cost } from '../types/models';
import { COMPONENT_ACTIVE_COLOR, COLOR_PRIMARY, COLOR_DARK_CARD } from '../utils/tokens';

const fsx = require('fs') as any;

function memory(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
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

function cost(sourceId: string, categorySourceId: string, deleted = false): Cost {
  const now = Date.now();
  return {
    sourceId,
    sourcePlatform: 'mp',
    carSourceId: 'car-1',
    categorySourceId,
    amount: 10,
    costDate: now,
    remark: '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted
  } as Cost;
}

describe('① 合并类别时回收站里的支出也改指', () => {
  it('别名类别下已软删的支出，归并后指向规范类别', () => {
    const a = new StorageAdapter(memory());
    a.insert('categories', cat({ sourceId: 'mp:category:停车', name: '停车', sortOrder: 0 }));
    a.insert('categories', cat({ sourceId: 'old-parking-fee', name: '停车费', isPreset: false }));
    a.insert('costs', cost('c-live', 'old-parking-fee', false));
    a.insert('costs', cost('c-deleted', 'old-parking-fee', true));

    seedPresetCategories(a);

    const all = a.list<Cost>('costs');
    expect(all.length).toBe(2);
    // 修复前只迁移未删除的，回收站那条会指向已删除的类别、恢复后显示「其他」
    for (const c of all) {
      expect(c.categorySourceId).toBe('mp:category:停车');
    }
  });

  it('同名预设去重时同样覆盖回收站支出', () => {
    const a = new StorageAdapter(memory());
    seedPresetCategories(a);
    // 造一个重复的「加油」预设，并挂一条已删除的支出
    a.insert(
      'categories',
      cat({ sourceId: 'dup-fuel', name: '加油', presetType: 'refuel', sortOrder: 200 })
    );
    a.insert('costs', cost('c-del', 'dup-fuel', true));

    seedPresetCategories(a);

    const c = a.list<Cost>('costs').find(x => x.sourceId === 'c-del')!;
    expect(c.categorySourceId).toBe('mp:category:加油');
  });
});

describe('② 改名后不再把原名归一化回来', () => {
  it('把「停车」改名后，导入含「停车费」的旧备份不会造出新的「停车」', () => {
    const a = new StorageAdapter(memory());
    seedPresetCategories(a);

    const parking = listCategories(a).find(c => c.name === '停车')!;
    updateCategory(a, parking.sourceId, '停车位', parking.icon);
    expect(listCategories(a).some(c => c.name === '停车')).toBe(false);

    // 模拟导入旧备份带入「停车费」
    a.insert(
      'categories',
      cat({ sourceId: 'legacy-parking-fee', name: '停车费', isPreset: false })
    );
    seedPresetCategories(a);

    const names = listCategories(a).map(c => c.name);
    // 用户的改名不能被旧备份「冲掉」
    expect(names).toContain('停车位');
    expect(names).not.toContain('停车');
  });

  it('未改名时仍会正常归一化（不误伤升级路径）', () => {
    const a = new StorageAdapter(memory());
    a.insert('categories', cat({ sourceId: 'x', name: '停车费', isPreset: false }));
    a.insert('categories', cat({ sourceId: 'y', name: '高速费', isPreset: false }));

    seedPresetCategories(a);

    const names = listCategories(a).map(c => c.name);
    expect(names).toContain('停车');
    expect(names).toContain('高速');
    expect(names).not.toContain('停车费');
  });
});

describe('③ 内联色值集中在 utils/tokens', () => {
  it('令牌值与 app.wxss 一致', () => {
    const css: string = fsx.readFileSync('app.wxss', 'utf-8');
    const pick = (n: string) => {
      const m = css.match(new RegExp(`--${n}:\\s*(#[0-9A-Fa-f]{6})`));
      if (!m) throw new Error(`缺少 --${n}`);
      return m[1].toUpperCase();
    };
    expect(COLOR_PRIMARY).toBe(pick('color-primary'));
    expect(COLOR_DARK_CARD).toBe(pick('color-dark-card'));
    expect(COMPONENT_ACTIVE_COLOR).toBe(COLOR_PRIMARY);
  });

  it('WXML 不再有内联 hex', () => {
    const files = [
      'pages/category-manage/index.wxml',
      'pages/maintain-item-form/index.wxml',
      'pages/user/index.wxml',
      'pages/icon-crop/index.wxml'
    ];
    for (const f of files) {
      const src: string = fsx.readFileSync(f, 'utf-8');
      expect(src).not.toMatch(/#[0-9A-Fa-f]{6}/);
    }
  });

  it('switch / slider 用变量而非字面色', () => {
    expect(fsx.readFileSync('pages/category-manage/index.wxml', 'utf-8')).toContain(
      'color="{{activeColor}}"'
    );
    expect(fsx.readFileSync('pages/icon-crop/index.wxml', 'utf-8')).toContain(
      'activeColor="{{activeColor}}"'
    );
  });
});

describe('④ 测试数据 sortOrder 与 seed 一致', () => {
  it('支出预设 0-3、系统预设 100-103、自定义接在 4', () => {
    const data = JSON.parse(fsx.readFileSync('test-data/icar-test-fuel.json', 'utf-8'));
    const rows = data.data.categories as Array<{ name: string; sortOrder: number }>;
    const order = (n: string) => rows.find(r => r.name === n)!.sortOrder;

    expect(order('停车')).toBe(0);
    expect(order('高速')).toBe(1);
    expect(order('保险')).toBe(2);
    expect(order('洗车')).toBe(3);
    expect(order('改装')).toBe(4);
    expect(order('加油')).toBe(100);
    expect(order('维修')).toBe(103);
  });

  it('与 seed 新建库的顺序一致', () => {
    const a = new StorageAdapter(memory());
    seedPresetCategories(a);
    addCategory(a, '改装', '🎨');

    const local = listCategories(a)
      .filter(c => !c.presetType)
      .map(c => c.name);

    const data = JSON.parse(fsx.readFileSync('test-data/icar-test-fuel.json', 'utf-8'));
    const imported = (data.data.categories as Array<{ name: string; sortOrder: number; presetType: string }>)
      .filter(c => !c.presetType)
      .sort((x, y) => x.sortOrder - y.sortOrder)
      .map(c => c.name);

    expect(imported).toEqual(local);
  });
});

describe('⑤ 保养选择器 ≤3 项不开启 scroll-y', () => {
  const files = ['pages/entry/index.wxml', 'pages/maintain-form/index.wxml'];

  for (const f of files) {
    it(`${f} 的 scroll-y 与「超过 3 项」绑定`, () => {
      const src: string = fsx.readFileSync(f, 'utf-8');
      // 无定高时开启 scroll-y，不同基础库表现不一致（可能吃掉点击或抖动）
      expect(src).toContain('scroll-y="{{maintains.length > 3}}"');
      expect(src).not.toMatch(/^\s*scroll-y\s*$/m);
    });
  }
});
