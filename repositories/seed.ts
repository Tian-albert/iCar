// 预设支出类别种子（设计报告 4.2.2）：幂等创建，仅当不存在时写入
import { Category } from '../types/models';
import { StorageAdapter } from './storage.adapter';

// 预设类别：加油 / 保养 / 维修 / 停车（停车无专用表单，presetType 为空）
const PRESETS: Array<Pick<Category, 'name' | 'icon' | 'presetType'>> = [
  { name: '加油', icon: 'oil', presetType: 'refuel' },
  { name: '保养', icon: 'maintain', presetType: 'maintain' },
  { name: '维修', icon: 'fix', presetType: 'fix' },
  { name: '停车', icon: 'p', presetType: '' }
];

export function seedPresetCategories(adapter: StorageAdapter): void {
  const all = adapter.list<Category>('categories');

  // 1. 补齐 visible 字段（旧数据默认显示）
  for (const c of all) {
    if (c.visible === undefined || c.visible === null) {
      c.visible = true;
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  }

  // 2. 降级旧"充电"预设为自定义（旧版本 seed 产物）
  for (const c of all) {
    if (c.isPreset && c.presetType === 'ev') {
      c.isPreset = false;
      c.presetType = '';
      c.visible = c.visible ?? true;
      c.updatedAt = Date.now();
      adapter.update('categories', c);
    }
  }

  // 3. 确保 4 个预设存在
  const current = adapter.list<Category>('categories');
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
