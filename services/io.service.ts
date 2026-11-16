// 数据导入导出（.icar 格式，对齐设计报告 4.5）
import { StorageAdapter } from '../repositories/storage.adapter';
import { Car } from '../types/models';
import { rebuildConsumptionsForCar } from './refuel.service';
import { syncMileages } from './car.service';
import { dedupePresetCategories, normalizeSpendCategoryAliases } from '../repositories/seed';
import { baseName, isManagedIconFile, iconFileExists, iconPathOf } from '../utils/icon-store';

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

/**
 * 各类实体的默认预设图标。
 *
 * 恢复备份时不还原自定义图标（那是本机文件），而是换成这里对应的预设图标——
 * 统一回落到 📌 会让「保养项」看起来像数据出错。
 */
const DEFAULT_ICON_BY_TABLE: Record<string, string> = {
  cars: '🚗',
  categories: '🧾',
  maintains: '🔧'
};

/**
 * 导出备份。
 *
 * **不打包图标**：图标是装饰，且自定义图标本质是本机文件，把它塞进 JSON 会让
 * 备份从几百 KB 涨到几 MB。恢复时统一换成预设图标即可（见 restoreDefaultIcon）。
 */
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
    source: { platform: 'mp', appVersion: '1.2.0', exportedAt: Date.now() },
    options: { amountUnit: 'yuan', timeUnit: 'ms', imageMode: 'file', package: 'json' },
    warnings: [] as string[],
    data
  };
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
 * 决定导入后的图标。
 *
 * 备份不带图标文件，所以：
 * - emoji 类图标（预设）：原样保留
 * - 自定义图片图标（`icon-*.png`，本机沙盒路径）：本机已有同文件则继续用
 *   （同机合并不误伤），否则换成该实体的**预设图标**——留失效路径只会裂图，
 *   而统一回落 📌 会让保养项之类看起来像数据出错。
 */
function resolveIcon(raw: string, table: string): string {
  const fallback = DEFAULT_ICON_BY_TABLE[table] || '';
  if (!raw) return fallback;

  const name = baseName(raw);
  if (!isManagedIconFile(name)) return raw;

  const local = iconPathOf(name);
  return local && iconFileExists(local) ? local : fallback;
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

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let cleared = 0;

  /*
   * 第一步：把整份备份在内存里过一遍（净化 + 图标回落 + 引用完整性校验），
   * 全部通过才动数据库。
   *
   * 为什么必须先做：覆盖导入原来是「先 clearTables 再逐条写」，
   * 一旦中途抛错（或写入的引用全是悬空的），旧数据已经没了、新数据又没写全，
   * 且本地 Storage 没有事务，无法回滚 —— 用户的数据就永久丢了。
   */
  const staged: Record<string, any[]> = {};
  for (const table of BUSINESS_TABLES) staged[table] = [];

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
      // 图标可能是别的设备上的沙盒路径：本机没有该文件就换成预设图标
      if (typeof clean.icon === 'string') {
        clean.icon = resolveIcon(clean.icon, table);
      }
      staged[table].push(clean);
    }
  }

  /*
   * 引用完整性校验：把指向不存在实体的**次级引用**断开。
   *
   * 备份里可能存在指向不存在实体的记录（手改过、或来自不同版本）。
   * 直接写进去会形成「看不见的孤儿」：比如一笔支出的类别不存在，
   * 页面回落成「其他」但统计里仍占一份金额；加油记录的 costSourceId 悬空，
   * 油费进了 fuel.totalCost 却不进 expense.total。
   * 这里把悬空的引用**清空该字段**，而不是丢弃整条记录 ——
   * 记录本身（金额、日期、里程）仍然有价值。
   *
   * 刻意**不处理 `carSourceId`**：
   * - 丢弃整条会静默损失用户数据（导入本就是为了保住数据）
   * - 清成空串只会让它更没意义
   * - 原样保留，等对应的车之后被导入时还能自动归位
   */
  const knownIds: Record<string, Set<string>> = {};
  for (const table of BUSINESS_TABLES) {
    knownIds[table] = new Set(staged[table].map(x => x.sourceId));
  }
  // 合并模式下，库里已有的实体同样算「存在」
  if (mode === 'merge') {
    for (const table of BUSINESS_TABLES) {
      for (const e of storage.list<any>(table)) {
        if (e && e.sourceId && !e.deleted) knownIds[table].add(e.sourceId);
      }
    }
  }

  /** 次级引用字段 → 目标表 */
  const REFS: Array<{ table: string; field: string; target: string }> = [
    { table: 'maintainLogs', field: 'maintainSourceId', target: 'maintains' },
    { table: 'maintainLogs', field: 'handleSourceId', target: 'maintainHandles' },
    { table: 'costs', field: 'categorySourceId', target: 'categories' },
    { table: 'costs', field: 'maintainHandleSourceId', target: 'maintainHandles' },
    { table: 'costs', field: 'repairSourceId', target: 'repairRecords' },
    { table: 'costs', field: 'fuelRecordSourceId', target: 'fuelRecords' },
    { table: 'maintainHandles', field: 'costSourceId', target: 'costs' },
    { table: 'repairRecords', field: 'costSourceId', target: 'costs' },
    { table: 'fuelRecords', field: 'costSourceId', target: 'costs' }
  ];

  for (const ref of REFS) {
    const known = knownIds[ref.target];
    for (const e of staged[ref.table]) {
      const v = e[ref.field];
      if (!v || typeof v !== 'string') continue;
      if (!known.has(v)) e[ref.field] = '';
    }
  }

  /*
   * 覆盖导入的回滚快照。
   *
   * 只把「校验」提前是不够的：清空之后逐条写入，写入阶段照样可能抛错
   * （存储配额满、某条数据触发适配器异常）。本地 Storage 没有事务，
   * 所以必须在清空前把现有数据整份留在内存里，失败时原样写回。
   *
   * 为什么用 exportBundle 而不是 `storage.list()`：
   * 后者会被逐条写入覆盖/新增，快照会跟着变；序列化成 JSON 才是真拷贝。
   * 这也顺带保住了回收站里的软删记录（exportBundle 只导未删项，
   * 但覆盖导入本来就只清业务表，软删记录也在其中 —— 见下面的 recover）。
   */
  let backupRaw: Record<string, any[]> | null = null;

  try {
    if (mode === 'replace') {
      // 先留快照，再清空。不清 user —— openid / 会员 / 置顶 / 已初始化标记
      // 都是本机属性，尤其 categoriesSeeded 若被清掉，下次启动会把用户删过的预设重新建出来。
      backupRaw = {};
      for (const table of BUSINESS_TABLES.concat(['fuelConsumptions'])) {
        // 逐条浅拷贝：适配器返回的是库里对象的引用，直接存起来会被后续写入改掉
        backupRaw[table] = storage.list<any>(table).map(e => ({ ...e }));
      }
      cleared = clearTables(storage, BUSINESS_TABLES.concat(['fuelConsumptions']));
    }

    // 第二步：落库。到这一步不会再因为数据格式问题中断。
    for (const table of BUSINESS_TABLES) {
      for (const clean of staged[table]) {
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
    // 本地 Storage 无事务：覆盖导入失败时把清空前的快照写回去，
    // 否则用户既没有新数据、也没了旧数据（这是最坏的结果）。
    if (mode === 'replace' && backupRaw) {
      try {
        for (const table of BUSINESS_TABLES.concat(['fuelConsumptions'])) {
          for (const e of backupRaw[table] || []) {
            storage.hardDelete(table, e.sourceId);
          }
          for (const e of backupRaw[table] || []) {
            storage.insert(table, e);
          }
        }
        storage.rebuildIndex();
        return fail('导入失败，已恢复到导入前的数据');
      } catch {
        return fail('导入失败，且自动恢复未完成，请重新导入备份文件');
      }
    }
    return fail('导入过程中发生错误，数据可能未完整导入');
  }

  return { ok: true, added, updated, skipped, cleared };
}
