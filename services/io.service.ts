// 数据导入导出（.icar 格式，对齐设计报告 4.5）
import { StorageAdapter } from '../repositories/storage.adapter';
import { Car } from '../types/models';
import { rebuildConsumptionsForCar } from './refuel.service';
import { syncMileages } from './car.service';
import { dedupePresetCategories } from '../repositories/seed';

/** 业务表（fuelConsumptions 为派生数据，导入时不 Upsert，由 rebuild 重算） */
const BUSINESS_TABLES = [
  'cars',
  'categories',
  'maintains',
  'maintainHandles',
  'maintainLogs',
  'costs',
  'repairRecords',
  'fuelRecords'
];

const EXPORT_TABLES = [...BUSINESS_TABLES, 'fuelConsumptions'];

export function exportBundle(storage: StorageAdapter): string {
  const data: Record<string, any> = {};
  for (const table of EXPORT_TABLES) {
    data[table] = storage.list(table).filter((e: any) => !e.deleted);
  }
  const user = storage.getUser();
  if (user) {
    const { openid, ...rest } = user; // 剥离 openid，不导出
    data['user'] = rest;
  }
  const manifest = {
    format: 'icar-export',
    version: 1,
    source: { platform: 'mp', appVersion: '1.0.0', exportedAt: Date.now() },
    options: { amountUnit: 'yuan', timeUnit: 'ms', imageMode: 'file', package: 'json' },
    warnings: [] as string[],
    data
  };
  return JSON.stringify(manifest, null, 2);
}

export interface ImportResult {
  ok: boolean;
  added: number;
  updated: number;
  skipped: number;
  message?: string;
}

export function importBundle(storage: StorageAdapter, json: string): ImportResult {
  let manifest: any;
  try {
    manifest = JSON.parse(json);
  } catch {
    return { ok: false, added: 0, updated: 0, skipped: 0, message: 'JSON 解析失败' };
  }
  if (!manifest || manifest.format !== 'icar-export') {
    return { ok: false, added: 0, updated: 0, skipped: 0, message: '不是有效的 iCar 导出数据' };
  }
  const data = (manifest.data || {}) as Record<string, any[]>;
  let added = 0;
  let updated = 0;
  let skipped = 0;

  // 业务表 Upsert（sourceId 不存在新增；updatedAt 更新则覆盖；否则跳过）
  for (const table of BUSINESS_TABLES) {
    for (const e of data[table] || []) {
      if (!e || !e.sourceId) continue;
      const existing = storage.get<any>(table, e.sourceId);
      if (!existing) {
        storage.insert(table, e);
        added++;
      } else if ((e.updatedAt || 0) > (existing.updatedAt || 0)) {
        storage.update(table, e);
        updated++;
      } else {
        skipped++;
      }
    }
  }

  // user 合并：reminderSentCount 取 max，不覆盖本地 openid/会员
  const importedUser = data['user'] as any;
  if (importedUser) {
    const local = storage.getUser();
    if (!local) {
      storage.setUser({
        ...importedUser,
        sourceId: importedUser.sourceId || 'mp:user:default',
        sourcePlatform: 'mp',
        openid: ''
      });
      added++;
    } else {
      if ((importedUser.reminderSentCount || 0) > local.reminderSentCount) {
        local.reminderSentCount = importedUser.reminderSentCount;
      }
      local.updatedAt = Date.now();
      storage.setUser(local);
      updated++;
    }
  }

  // 导入可能带入同名预设（sourceId 与本地不同），合并去重后再重建派生数据
  dedupePresetCategories(storage);

  // 重建派生数据：区间 + 里程
  const cars = storage.list<Car>('cars').filter(c => !c.deleted);
  for (const car of cars) {
    rebuildConsumptionsForCar(storage, car.sourceId);
    syncMileages(storage, car.sourceId);
  }

  return { ok: true, added, updated, skipped };
}
