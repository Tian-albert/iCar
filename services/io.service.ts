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
    source: { platform: 'mp', appVersion: '1.0.4', exportedAt: Date.now() },
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

/** 数值字段兜底：非有限数一律回退默认值，避免 NaN 污染统计 */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** 非负数值字段：负数按 0 处理 */
function nonNeg(v: unknown): number {
  return Math.max(0, num(v, 0));
}

/**
 * 导入条目的数值净化：逐表把金额 / 里程 / 百分比等关键字段兜底。
 * 只做「不让脏数据进库」的最小处理，不做业务规则校验（Q7=A）。
 * 返回 null 表示该条不可用。
 */
function sanitizeImported(table: string, e: any): any | null {
  if (!e || typeof e.sourceId !== 'string' || !e.sourceId) return null;
  const out = { ...e };
  out.createdAt = num(out.createdAt, Date.now());
  out.updatedAt = num(out.updatedAt, out.createdAt);
  out.deleted = false;

  switch (table) {
    case 'fuelRecords':
      out.makeMileages = nonNeg(out.makeMileages);
      out.makeEVMileages = nonNeg(out.makeEVMileages);
      out.makeHEVMileages = nonNeg(out.makeHEVMileages);
      out.unitPrice = nonNeg(out.unitPrice);
      out.volume = nonNeg(out.volume);
      out.shouldPayAmount = nonNeg(out.shouldPayAmount);
      out.actualPayAmount = nonNeg(out.actualPayAmount);
      out.chargeBeforePercent = Math.min(100, nonNeg(out.chargeBeforePercent));
      out.chargeAfterPercent = Math.min(100, nonNeg(out.chargeAfterPercent));
      out.energyType = out.energyType === 'ev' || out.energyType === 'hybrid' ? out.energyType : 'fuel';
      break;
    case 'costs':
      out.amount = nonNeg(out.amount);
      break;
    case 'repairRecords':
      out.mileage = nonNeg(out.mileage);
      out.amount = nonNeg(out.amount);
      out.images = Array.isArray(out.images) ? out.images : [];
      break;
    case 'maintainHandles':
      out.makeMileages = nonNeg(out.makeMileages);
      out.makeEVMileages = nonNeg(out.makeEVMileages);
      out.makeHEVMileages = nonNeg(out.makeHEVMileages);
      break;
    case 'maintainLogs':
      out.makeMileages = nonNeg(out.makeMileages);
      out.totalMileages = nonNeg(out.totalMileages);
      break;
    case 'maintains':
      out.cycleMileages = nonNeg(out.cycleMileages);
      out.cycleMonths = nonNeg(out.cycleMonths);
      out.cycleDays = nonNeg(out.cycleDays);
      break;
    case 'cars':
      out.mileages = nonNeg(out.mileages);
      out.initMileages = nonNeg(out.initMileages);
      out.evMileages = nonNeg(out.evMileages);
      out.hevMileages = nonNeg(out.hevMileages);
      out.batteryCapacity = nonNeg(out.batteryCapacity);
      out.energyType = out.energyType === 'ev' || out.energyType === 'hybrid' ? out.energyType : 'fuel';
      break;
    case 'categories':
      out.sortOrder = nonNeg(out.sortOrder);
      break;
    default:
      break;
  }
  return out;
}

export function importBundle(storage: StorageAdapter, json: string): ImportResult {
  const fail = (message: string): ImportResult => ({
    ok: false,
    added: 0,
    updated: 0,
    skipped: 0,
    message
  });

  let manifest: any;
  try {
    manifest = JSON.parse(json);
  } catch {
    return fail('JSON 解析失败');
  }
  if (!manifest || typeof manifest !== 'object' || manifest.format !== 'icar-export') {
    return fail('不是有效的 iCar 导出数据');
  }
  const data = manifest.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('备份数据格式错误（缺少 data）');
  }
  // 各业务表必须是数组；缺失视为空表（只做结构校验，不逐字段深校验）
  for (const table of BUSINESS_TABLES) {
    const value = data[table];
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      return fail(`数据表 ${table} 格式错误`);
    }
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  try {
    // 业务表 Upsert：跳过软删记录与非法条目，避免已删数据复活或写入脏实体
    for (const table of BUSINESS_TABLES) {
      for (const e of (data[table] || []) as any[]) {
        if (
          !e ||
          typeof e !== 'object' ||
          Array.isArray(e) ||
          !e.sourceId ||
          e.deleted === true
        ) {
          skipped++;
          continue;
        }
        // 导入绕过 service 层，必须在此把数值兜干净：
        // 一条 amount: NaN 会让统计页总支出与图表直接显示 NaN
        const clean = sanitizeImported(table, e);
        if (!clean) {
          skipped++;
          continue;
        }
        const existing = storage.get<any>(table, clean.sourceId);
        if (!existing) {
          storage.insert(table, clean);
          added++;
        } else if ((clean.updatedAt || 0) > (existing.updatedAt || 0)) {
          storage.update(table, clean);
          updated++;
        } else {
          skipped++;
        }
      }
    }

    // user 合并：reminderSentCount 取 max，不覆盖本地 openid / 会员
    const importedUser = data['user'] as any;
    if (importedUser && typeof importedUser === 'object' && !Array.isArray(importedUser)) {
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
        if ((importedUser.reminderSentCount || 0) > (local.reminderSentCount || 0)) {
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
      // 导入是全量重算，允许按导入后的记录回退里程
      syncMileages(storage, car.sourceId, true);
    }
  } catch {
    // 本地 Storage 无事务：失败时如实告知，不伪装成功
    return fail('导入过程中发生错误，数据可能未完整导入');
  }

  return { ok: true, added, updated, skipped };
}
