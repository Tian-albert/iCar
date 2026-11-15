// 预设支出类别种子（设计报告 4.2.2）：幂等创建 + 同名预设去重
import { Category, Cost } from '../types/models';
import { StorageAdapter } from './storage.adapter';

/**
 * 系统预设：由「加油 / 充电 / 保养 / 维修」四个专用表单自动关联生成支出
 * （见 refuel / maintain-record / repair 服务的 presetType 查询）。
 *
 * 这些类别**必须保留**，否则自动生成的支出会归到「其他」。
 * 但它们**不出现在「记支出」的类别选择里** —— 那样会和专用录入重复，
 * 用户还能手动选「加油」再记一笔加油，导致同一次消费被记两遍。
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
 */
const SPEND_PRESETS: Array<Pick<Category, 'name' | 'icon' | 'presetType'>> = [
  { name: '停车费', icon: 'p', presetType: '' },
  { name: '洗车', icon: 'wash', presetType: '' },
  { name: '高速费', icon: 'toll', presetType: '' },
  { name: '保险', icon: 'shield', presetType: '' }
];

/** 是否系统预设（不出现在支出类别选择与类别管理里） */
export function isSystemPreset(c: Pick<Category, 'presetType'>): boolean {
  return !!c.presetType;
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
 * 「停车」→「停车费」改名（旧库升级）。
 *
 * 保留原 sourceId：支出记录靠 sourceId 关联，换 id 就得重指全部历史支出，
 * 风险远大于收益（sourceId 对用户不可见）。
 * 若已存在「停车费」（用户自定义过同名类别），则把「停车」并入它再软删，
 * 避免升级后出现两个「停车费」。
 */
function renameLegacyParking(adapter: StorageAdapter): void {
  const all = adapter.list<Category>('categories').filter(c => !c.deleted);
  const legacy = all.find(c => c.isPreset && c.name === '停车');
  if (!legacy) return;

  const target = all.find(c => c.name === '停车费');
  if (target && target.sourceId !== legacy.sourceId) {
    mergeCategoryInto(adapter, legacy, target);
    return;
  }

  legacy.name = '停车费';
  legacy.isPreset = true;
  legacy.presetType = '';
  legacy.updatedAt = Date.now();
  adapter.update('categories', legacy);
}

export function seedPresetCategories(adapter: StorageAdapter): void {
  // 0. 先做同名预设去重（自愈历史重复数据）
  dedupePresetCategories(adapter);

  // 0.5 「停车」改名为「停车费」，必须在补齐预设之前做，
  //     否则会先插入一条新的「停车费」，与旧「停车」并存。
  renameLegacyParking(adapter);

  const all = adapter.list<Category>('categories').filter(c => !c.deleted);

  // 1. 补齐 visible / sortOrder 字段（旧数据默认显示、按当前顺序编号）
  const presetList = all.filter(c => c.isPreset);
  const customList = all.filter(c => !c.isPreset);
  presetList.forEach((c, i) => {
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
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  });
  customList.forEach((c, i) => {
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
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  });

  // 2. R-07：旧版本把「充电」预设降级成了自定义类别，这里升级回预设，
  //    保证充电记录的关联支出能归到「充电」而不是「其他」。
  for (const c of all) {
    if (c.name === '充电' && !c.isPreset && c.presetType !== 'ev') {
      c.isPreset = true;
      c.presetType = 'ev';
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  }

  // 3. 确保系统预设与支出预设都存在（仅按未删除记录判断，避免"软删后不再重建"）
  const ensure = (
    list: Array<Pick<Category, 'name' | 'icon' | 'presetType'>>,
    baseOrder: number,
    /** 同名自定义类别是否升级为预设（仅系统预设需要，见下方注释） */
    upgradeSameName: boolean
  ) => {
    const current = adapter.list<Category>('categories').filter(c => !c.deleted);
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
  };

  ensure(SPEND_PRESETS, 0, false);
  ensure(SYSTEM_PRESETS, 100, true);
}
