// 全局存储单例：首次访问时初始化（迁移 + 索引对账 + 预设类别种子）
import { StorageAdapter } from '../repositories/storage.adapter';
import { createWxStorageLike } from '../repositories/wx-storage';
import { runMigrations } from '../repositories/migration';
import { seedPresetCategories } from '../repositories/seed';
import { purgeExpired } from '../services/recycle.service';

let adapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (!adapter) {
    adapter = new StorageAdapter(createWxStorageLike());
    // 先对账索引再 seed：seed 依赖 list()（走索引），索引为空/损坏时会误判
    // "预设不存在"并重复插入，用户会看到两套「加油/保养/维修/停车/充电」
    adapter.rebuildIndex();
    runMigrations(adapter);
    seedPresetCategories(adapter);
    // 软删记录保留 30 天，启动即清理过期项（R-03）
    purgeExpired(adapter);
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
