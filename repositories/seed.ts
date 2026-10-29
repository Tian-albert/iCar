// 预设支出类别种子（设计报告 4.2.2）：幂等创建 + 同名预设去重
import { Category, Cost } from '../types/models';
import { StorageAdapter } from './storage.adapter';

// 预设类别：加油 / 保养 / 维修 / 停车（停车无专用表单，presetType 为空）
const PRESETS: Array<Pick<Category, 'name' | 'icon' | 'presetType' | 'sortOrder'>> = [
  { name: '加油', icon: 'oil', presetType: 'refuel', sortOrder: 0 },
  { name: '保养', icon: 'maintain', presetType: 'maintain', sortOrder: 1 },
  { name: '维修', icon: 'fix', presetType: 'fix', sortOrder: 2 },
  { name: '停车', icon: 'p', presetType: '', sortOrder: 3 }
];

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

export function seedPresetCategories(adapter: StorageAdapter): void {
  // 0. 先做同名预设去重（自愈历史重复数据）
  dedupePresetCategories(adapter);

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

  // 2. 降级旧"充电"预设为自定义（旧版本 seed 产物）
  for (const c of all) {
    if (c.isPreset && c.presetType === 'ev') {
      c.isPreset = false;
      c.presetType = '';
      c.visible = c.visible ?? true;
      c.sortOrder = c.sortOrder ?? 0;
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  }

  // 3. 确保 4 个预设存在（仅按未删除记录判断，避免"软删后不再重建"）
  const current = adapter.list<Category>('categories').filter(c => !c.deleted);
  for (const preset of PRESETS) {
    if (current.some(c => c.name === preset.name && c.isPreset)) continue;
    const now = Date.now();
    adapter.insert<Category>('categories', {
      ...preset,
      sourceId: `mp:category:${preset.name}`,
      sourcePlatform: 'mp',
      isPreset: true,
      visible: true,
      createdAt: now,
      updatedAt: now,
      deleted: false
    });
  }
}
