// 预设支出类别种子（设计报告 4.2.2）：幂等创建 + 同名预设去重
import { Category, Cost, User } from '../types/models';
import { StorageAdapter } from './storage.adapter';

/**
 * 系统预设：由「加油 / 充电 / 保养 / 维修」四个专用表单自动关联生成支出
 * （见 refuel / maintain-record / repair 服务的 presetType 查询）。
 *
 * 这些类别**必须始终存在**，否则自动生成的支出会归到「其他」。
 * 但它们**不出现在「记支出」的类别选择里** —— 那样会和专用录入重复，
 * 用户还能手动选「加油」再记一笔加油，导致同一次消费被记两遍。
 * 它们也不在类别管理页展示，用户无从删除，所以由 seed 无条件保证。
 */
const SYSTEM_PRESETS: Array<Pick<Category, 'name' | 'icon' | 'presetType'>> = [
  { name: '加油', icon: 'oil', presetType: 'refuel' },
  { name: '充电', icon: 'ev', presetType: 'ev' },
  { name: '保养', icon: 'maintain', presetType: 'maintain' },
  { name: '维修', icon: 'fix', presetType: 'fix' }
];

/**
 * 支出预设：记支出时用户可选的常用项（presetType 为空）。
 * 加油/充电/保养/维修不在此列，它们走各自的录入表单。
 *
 * 只在**首次初始化**时创建一次（见 seedPresetCategories），之后完全交给用户：
 * 删掉的不再重建，改过名的也不会再冒出原名。
 */
const SPEND_PRESETS: Array<Pick<Category, 'name' | 'icon' | 'presetType'>> = [
  { name: '停车', icon: 'p', presetType: '' },
  { name: '高速', icon: 'toll', presetType: '' },
  { name: '保险', icon: 'shield', presetType: '' },
  { name: '洗车', icon: 'wash', presetType: '' }
];

/**
 * 支出预设的「曾用名」→ 规范名。
 *
 * 历史版本曾把这两个建成「停车费 / 高速费」，现统一规范为「停车 / 高速」，
 * 因此升级时要把旧名类别的支出记录归并到规范名上，否则同一类消费会分列两处。
 */
const SPEND_PRESET_ALIASES: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: '停车', aliases: ['停车费'] },
  { canonical: '高速', aliases: ['高速费'] }
];

/** 是否系统预设（不出现在支出类别选择与类别管理里） */
export function isSystemPreset(c: Pick<Category, 'presetType'>): boolean {
  return !!c.presetType;
}

/** 未删除的类别（保留原始顺序，不排序） */
function aliveCategories(adapter: StorageAdapter): Category[] {
  return adapter.list<Category>('categories').filter(c => !c.deleted);
}

/**
 * 同名预设去重：历史数据可能残留多条同名预设
 * （早期 seed 用随机 sourceId，或导入备份时按 sourceId 新增）。
 * 保留优先项（sourceId = mp:category:<name>），其余软删并把支出记录迁移过去。
 */
export function dedupePresetCategories(adapter: StorageAdapter): void {
  const presets = adapter.list<Category>('categories').filter(c => c.isPreset && !c.deleted);
  const grouped = new Map<string, Category[]>();
  for (const c of presets) {
    const arr = grouped.get(c.name) ?? [];
    arr.push(c);
    grouped.set(c.name, arr);
  }

  const now = Date.now();
  for (const [name, list] of grouped) {
    if (list.length <= 1) continue;
    const canonicalId = `mp:category:${name}`;
    const keep = list.find(c => c.sourceId === canonicalId) ?? list[0];

    for (const dup of list) {
      if (dup.sourceId === keep.sourceId) continue;
      // 支出记录改指向保留项，避免统计与列表出现"其他"
      const costs = adapter
        .list<Cost>('costs')
        .filter(x => x.categorySourceId === dup.sourceId && !x.deleted);
      for (const cost of costs) {
        cost.categorySourceId = keep.sourceId;
        cost.updatedAt = now;
        adapter.update('costs', cost);
      }
      adapter.softDelete('categories', dup.sourceId);
    }
  }
}

/** 把 from 的支出记录全部改指向 to，然后软删 from */
function mergeCategoryInto(adapter: StorageAdapter, from: Category, to: Category): void {
  const now = Date.now();
  const costs = adapter
    .list<Cost>('costs')
    .filter(x => x.categorySourceId === from.sourceId && !x.deleted);
  for (const cost of costs) {
    cost.categorySourceId = to.sourceId;
    cost.updatedAt = now;
    adapter.update('costs', cost);
  }
  adapter.softDelete('categories', from.sourceId);
}

/**
 * 把「曾用名」类别归并到规范名（旧库升级）。
 *
 * - 规范名已存在 → 每个别名类别的支出改指向规范类别，别名软删
 * - 规范名不存在 → 取第一个别名**原地改名**，其余并入
 *
 * 原地改名而不换 sourceId：支出记录靠 sourceId 关联，换 id 就要迁移全部
 * 历史支出且容易漏；sourceId 对用户不可见，改名不影响任何展示。
 */
function normalizePresetName(
  adapter: StorageAdapter,
  canonical: string,
  aliases: string[]
): void {
  const all = aliveCategories(adapter);
  const olds = all.filter(c => aliases.indexOf(c.name) >= 0);
  if (!olds.length) return;

  const target = all.find(c => c.name === canonical);
  if (target) {
    for (const old of olds) mergeCategoryInto(adapter, old, target);
    return;
  }

  // 规范名还没有：第一个原地改名成规范名（它承接全部历史支出），其余并入它
  const first = olds[0];
  first.name = canonical;
  first.isPreset = true;
  first.presetType = '';
  first.updatedAt = Date.now();
  adapter.update('categories', first);

  for (let i = 1; i < olds.length; i++) {
    mergeCategoryInto(adapter, olds[i], first);
  }
}

/** 归并支出类别的曾用名（停车费→停车、高速费→高速）。首次初始化与备份导入共用 */
export function normalizeSpendCategoryAliases(adapter: StorageAdapter): void {
  for (const item of SPEND_PRESET_ALIASES) {
    normalizePresetName(adapter, item.canonical, item.aliases);
  }
}

/** 补齐 visible / sortOrder 缺省值（旧数据可能没有这两个字段） */
function fillCategoryDefaults(adapter: StorageAdapter): void {
  const now = Date.now();
  aliveCategories(adapter).forEach((c, i) => {
    let changed = false;
    if (c.visible === undefined || c.visible === null) {
      c.visible = true;
      changed = true;
    }
    if (c.sortOrder === undefined || c.sortOrder === null) {
      c.sortOrder = i;
      changed = true;
    }
    if (changed) {
      c.updatedAt = now;
      adapter.update('categories', c);
    }
  });
}

/**
 * 把支出类别（系统预设之外）的 sortOrder 重排为 0..n-1 的单一序列。
 *
 * 合并「预设 / 自定义」分组后列表不再分段，而两套独立编号（预设 0-3、
 * 自定义 0-1…）会交错误序。这里按**当前视觉顺序**（预设在前、各自内部
 * 按原 sortOrder）重新编号，用户看不出变化。
 */
function renumberSpendCategories(adapter: StorageAdapter): void {
  const list = aliveCategories(adapter).filter(c => !c.presetType);
  list.sort((a, b) => {
    if (a.isPreset !== b.isPreset) return a.isPreset ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  const now = Date.now();
  list.forEach((c, i) => {
    if (c.sortOrder !== i) {
      c.sortOrder = i;
      c.updatedAt = now;
      adapter.update('categories', c);
    }
  });
}

/** 确保某组预设存在；upgradeSameName 见下方注释 */
function ensurePresets(
  adapter: StorageAdapter,
  list: Array<Pick<Category, 'name' | 'icon' | 'presetType'>>,
  baseOrder: number,
  /** 同名自定义类别是否升级为预设（仅系统预设需要，见下方注释） */
  upgradeSameName: boolean
): void {
  const current = aliveCategories(adapter);
  const presets = current.filter(c => c.isPreset);
  let nextOrder = presets.length
    ? Math.max(...presets.map(c => c.sortOrder ?? 0)) + 1
    : baseOrder;

  for (const preset of list) {
    if (current.some(c => c.name === preset.name && c.isPreset)) continue;

    const sameName = current.find(c => c.name === preset.name);
    if (sameName) {
      // 同名自定义类别已存在，不再插入以免重名。但两类预设处理不同：
      // - 支出预设：让位即可，用户自建的那个本来就承担同样用途；
      // - 系统预设：**必须升级**。refuel / maintain-record / repair 靠 presetType
      //   找类别，若库里只有同名自定义类别（presetType 为空），
      //   保存加油会直接抛「预设支出类别缺失」——功能不可用。
      if (upgradeSameName && preset.presetType) {
        sameName.isPreset = true;
        sameName.presetType = preset.presetType;
        sameName.updatedAt = Date.now();
        adapter.update('categories', sameName);
      }
      continue;
    }

    const now = Date.now();
    adapter.insert<Category>('categories', {
      ...preset,
      sourceId: `mp:category:${preset.name}`,
      sourcePlatform: 'mp',
      isPreset: true,
      visible: true,
      sortOrder: nextOrder++,
      createdAt: now,
      updatedAt: now,
      deleted: false
    });
  }
}

/** 标记「支出预设已初始化」。user 缺失时补建，避免静默失败 */
function markCategoriesSeeded(adapter: StorageAdapter): void {
  const existing = adapter.getUser();
  if (existing && existing.categoriesSeeded) return;

  const user: User =
    existing ||
    ({
      sourceId: 'mp:user:default',
      sourcePlatform: 'mp',
      openid: '',
      nickname: '',
      avatarUrl: '',
      remindEnabled: true,
      reminderSentCount: 0,
      memberLevel: 'free',
      memberExpireAt: 0,
      appLockEnabled: false,
      appLockPin: '',
      lastPulledAt: 0,
      pinnedCarId: '',
      categoriesSeeded: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as User);

  user.categoriesSeeded = true;
  user.updatedAt = Date.now();
  adapter.setUser(user);
}

/**
 * 初始化预设类别（启动时调用）。
 *
 * 分两类处理：
 * - **系统预设**（加油/充电/保养/维修）：无条件确保存在，缺失即功能不可用
 * - **支出预设**（停车/高速/保险/洗车）：**只在首次初始化时创建一次**，
 *   之后完全交给用户管理 —— 删掉的不重建、改过名的不再冒出原名
 *
 * 「首次」由 `user.categoriesSeeded` 判定。老用户升级时该字段为空，
 * 会完整跑一次初始化（补预设 + 归并曾用名 + 重排序号）后打上标记。
 */
export function seedPresetCategories(adapter: StorageAdapter): void {
  // 自愈性质的修复，任何时候都跑
  dedupePresetCategories(adapter);
  fillCategoryDefaults(adapter);

  // R-07：旧版本把「充电」预设降级成了自定义类别，这里升级回预设，
  // 保证充电记录的关联支出能归到「充电」而不是「其他」。
  for (const c of aliveCategories(adapter)) {
    if (c.name === '充电' && !c.isPreset && c.presetType !== 'ev') {
      c.isPreset = true;
      c.presetType = 'ev';
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  }

  ensurePresets(adapter, SYSTEM_PRESETS, 100, true);

  const user = adapter.getUser();
  if (user && user.categoriesSeeded) return;

  // 归并必须早于补建：否则会先插入规范名的新类别，与旧名并存
  normalizeSpendCategoryAliases(adapter);
  ensurePresets(adapter, SPEND_PRESETS, 0, false);
  renumberSpendCategories(adapter);
  markCategoriesSeeded(adapter);
}
