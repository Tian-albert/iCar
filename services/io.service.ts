// 数据导入导出（.icar 格式，对齐设计报告 4.5）
import { StorageAdapter } from '../repositories/storage.adapter';
import { Car } from '../types/models';
import { rebuildConsumptionsForCar } from './refuel.service';
import { syncMileages } from './car.service';
import { dedupePresetCategories, normalizeSpendCategoryAliases } from '../repositories/seed';
import {
  baseName,
  isManagedIconFile,
  readIconBase64,
  writeIconBase64,
  iconFileExists,
  iconPathOf
} from '../utils/icon-store';

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

export interface ExportOptions {
  /**
   * 是否把自定义图标以 base64 一并导出。
   *
   * 图标文件本身不在 JSON 里，实体的 icon 只是本机沙盒路径；
   * 不带图标的话，换机后所有自定义图标都会裂图。
   */
  includeIcons?: boolean;
}

/** 选择「包含图标」时允许的最大 base64 总字符数（约 3MB） */
export const ICON_EXPORT_MAX_CHARS = 4 * 1024 * 1024;

/** 带有 icon 字段、需要一起打包图标的业务表 */
const ICON_TABLES = ['cars', 'categories', 'maintains'];

/** 备份里的图标资源表：文件名 → base64 */
type IconPayload = Record<string, string>;

export function exportBundle(storage: StorageAdapter, options: ExportOptions = {}): string {
  const data: Record<string, any> = {};
  for (const table of EXPORT_TABLES) {
    data[table] = storage.list(table).filter((e: any) => !e.deleted);
  }
  const user = storage.getUser();
  if (user) {
    const { openid, ...rest } = user; // 剥离 openid，不导出
    data['user'] = rest;
  }

  // 可选：把实体引用的自定义图标读成 base64 一并带走
  const icons: IconPayload = {};
  if (options.includeIcons) {
    const paths = new Set<string>();
    for (const table of ICON_TABLES) {
      for (const e of (data[table] || []) as Array<{ icon?: string }>) {
        if (e && e.icon) paths.add(e.icon);
      }
    }

    let total = 0;
    for (const p of paths) {
      const name = baseName(p);
      if (!name || !isManagedIconFile(name) || icons[name]) continue;
      const b64 = readIconBase64(p);
      if (!b64) continue;
      total += b64.length;
      if (total > ICON_EXPORT_MAX_CHARS) {
        // 宁可报错也不静默丢图标——丢了用户换机后才发现裂图
        throw new Error('自定义图标过多，请先清理部分图标，或取消勾选「包含自定义图标」');
      }
      icons[name] = b64;
    }
  }

  const hasIcons = Object.keys(icons).length > 0;
  const manifest: any = {
    format: 'icar-export',
    version: 1,
    source: { platform: 'mp', appVersion: '1.2.0', exportedAt: Date.now() },
    options: {
      amountUnit: 'yuan',
      timeUnit: 'ms',
      imageMode: hasIcons ? 'base64' : 'file',
      package: 'json'
    },
    warnings: [] as string[],
    data
  };
  if (hasIcons) manifest.icons = icons;
  return JSON.stringify(manifest, null, 2);
}

/**
 * 导入方式：
 * - `merge`：合并到现有数据（同 id 按 updatedAt 较新者覆盖），本地多出的记录保留
 * - `replace`：先清空本机业务数据，再整份写入（备份里没有的不会留下）
 */
export type ImportMode = 'merge' | 'replace';

export interface ImportResult {
  ok: boolean;
  added: number;
  updated: number;
  skipped: number;
  /** 覆盖导入时被清空的记录数 */
  cleared: number;
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

/**
 * 把实体上的图标路径解析成本机可用的路径。
 *
 * - emoji / 外部资源：原样返回
 * - 自定义图标（`icon-*.png`）：备份里带了这个文件就写回沙盒；
 *   否则本地若已有该文件则继续用；都没有则**清空** ——
 *   让 UI 回落到默认 emoji，好过显示一张裂图。
 */
function resolveIcon(raw: string, icons: IconPayload): string {
  if (!raw) return '';
  const name = baseName(raw);
  if (!isManagedIconFile(name)) return raw;

  const b64 = icons[name];
  if (b64) {
    const written = writeIconBase64(name, b64);
    if (written) return written;
  }

  const local = iconPathOf(name);
  return local && iconFileExists(local) ? local : '';
}

/** 物理清空若干表（含已软删的记录），返回清掉的条数 */
function clearTables(storage: StorageAdapter, tables: string[]): number {
  let removed = 0;
  for (const table of tables) {
    for (const e of storage.list<{ sourceId: string }>(table)) {
      storage.hardDelete(table, e.sourceId);
      removed++;
    }
  }
  return removed;
}

export function importBundle(
  storage: StorageAdapter,
  json: string,
  mode: ImportMode = 'merge'
): ImportResult {
  const fail = (message: string): ImportResult => ({
    ok: false,
    added: 0,
    updated: 0,
    skipped: 0,
    cleared: 0,
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

  // 备份若带了图标资源（导出时勾选「包含自定义图标」），这里要用它还原沙盒文件
  const icons: IconPayload =
    manifest.icons && typeof manifest.icons === 'object' && !Array.isArray(manifest.icons)
      ? (manifest.icons as IconPayload)
      : {};

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let cleared = 0;

  try {
    if (mode === 'replace') {
      // 覆盖导入：先物理清空业务表与派生表，再整份写入。
      // 不清 user —— openid / 会员 / 置顶 / 已初始化标记都是本机属性，
      // 尤其 categoriesSeeded 若被清掉，下次启动会把用户删过的预设重新建出来。
      cleared = clearTables(storage, BUSINESS_TABLES.concat(['fuelConsumptions']));
    }

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
        // 图标可能是别的设备上的沙盒路径：能还原就还原，还原不了就清空回落 emoji
        if (typeof clean.icon === 'string' && clean.icon) {
          clean.icon = resolveIcon(clean.icon, icons);
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
    // 旧备份可能带「停车费 / 高速费」这类曾用名。启动时的归并只在首次初始化跑，
    // 导入这条路径必须自己补一次，否则会和本地的「停车 / 高速」并存。
    normalizeSpendCategoryAliases(storage);

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

  return { ok: true, added, updated, skipped, cleared };
}
