// 全局存储单例：首次访问时初始化（迁移 + 索引对账 + 预设类别种子）
import { StorageAdapter } from '../repositories/storage.adapter';
import { createWxStorageLike } from '../repositories/wx-storage';
import { runMigrations } from '../repositories/migration';
import { seedPresetCategories } from '../repositories/seed';

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = new StorageAdapter(createWxStorageLike());
    runMigrations(adapter);
    seedPresetCategories(adapter);
    adapter.rebuildIndex();
  }
  return adapter;
}

/** 表名常量（与 DataBundle 键、存储 key 前缀一致） */
export const TABLES = {
  cars: 'cars',
  categories: 'categories',
  maintains: 'maintains',
  maintainHandles: 'maintainHandles',
  maintainLogs: 'maintainLogs',
  costs: 'costs',
  repairRecords: 'repairRecords',
  fuelRecords: 'fuelRecords',
  fuelConsumptions: 'fuelConsumptions'
} as const;
