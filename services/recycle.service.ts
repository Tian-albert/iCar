// 回收站（R-02 / R-03）：软删批次、撤销、30 天过期清理、车辆级联删除
import { StorageAdapter } from '../repositories/storage.adapter';
import { genId } from '../utils/id';
import { rebuildConsumptionsForCar } from './refuel.service';
import { syncMileages } from './car.service';

export const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 车辆删除时需要一起软删的从属表（按 carSourceId 过滤） */
const CAR_CHILD_TABLES = [
  'fuelRecords',
  'costs',
  'maintainHandles',
  'maintainLogs',
  'maintains',
  'repairRecords',
  'fuelConsumptions'
];

/** 回收站扫描的业务表；fuelConsumptions 是派生数据，由重算重建，不进回收站 */
const SCAN_TABLES = [
  'cars',
  'categories',
  'fuelRecords',
  'costs',
  'maintainHandles',
  'maintainLogs',
  'maintains',
  'repairRecords'
];

export interface RecycleRef {
  table: string;
  id: string;
}

export interface RecycleBatch {
  batch: string;
  title: string;
  deletedAt: number;
  count: number;
  refs: RecycleRef[];
}

function describe(table: string, e: any): string {
  switch (table) {
    case 'cars': return `车辆：${e.name ?? ''}`;
    case 'categories': return `支出类别：${e.name ?? ''}`;
    case 'maintains': return `保养项：${e.name ?? ''}`;
    case 'fuelRecords': return `加油记录 · ${e.makeMileages ?? 0} km`;
    case 'maintainHandles': return `保养记录 · ${e.makeMileages ?? 0} km`;
    case 'repairRecords': return `维修记录 · ${e.content ?? ''}`;
    case 'costs': return `支出记录 · ¥${e.amount ?? 0}`;
    default: return '记录';
  }
}

/** 按批次聚合所有软删记录，倒序返回（每条可在 30 天内整批恢复） */
export function listRecycleBatches(storage: StorageAdapter): RecycleBatch[] {
  const map = new Map<string, RecycleBatch>();
  for (const table of SCAN_TABLES) {
    for (const e of storage.list<any>(table)) {
      if (!e.deleted) continue;
      const batch: string = e.deleteBatch || e.sourceId;
      const deletedAt: number = e.deletedAt || e.updatedAt || 0;
      const ref: RecycleRef = { table, id: e.sourceId };
      const hit = map.get(batch);
      if (hit) {
        hit.count++;
        hit.refs.push(ref);
        hit.deletedAt = Math.max(hit.deletedAt, deletedAt);
        // 车辆批次优先用车辆名做标题
        if (table === 'cars') hit.title = describe(table, e);
      } else {
        map.set(batch, {
          batch,
          title: describe(table, e),
          deletedAt,
          count: 1,
          refs: [ref]
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.deletedAt - a.deletedAt);
}

/** 整批恢复；恢复后重建受影响车辆的区间与里程 */
export function restoreBatch(storage: StorageAdapter, batch: string): boolean {
  const target = listRecycleBatches(storage).find(b => b.batch === batch);
  if (!target) return false;
  for (const ref of target.refs) storage.restore(ref.table, ref.id);

  const carIds = new Set<string>();
  for (const ref of target.refs) {
    if (ref.table === 'cars') carIds.add(ref.id);
    const e = storage.get<any>(ref.table, ref.id);
    if (e?.carSourceId) carIds.add(e.carSourceId);
  }
  for (const carId of carIds) {
    const car = storage.get<any>('cars', carId);
    if (car && !car.deleted) {
      rebuildConsumptionsForCar(storage, carId);
      syncMileages(storage, carId);
    }
  }
  return true;
}

/** 物理清理超过保留期的软删记录，返回清理条数 */
export function purgeExpired(storage: StorageAdapter, days = RETENTION_DAYS): number {
  const cutoff = Date.now() - days * DAY_MS;
  let n = 0;
  for (const table of SCAN_TABLES) {
    for (const e of storage.list<any>(table)) {
      if (e.deleted && (e.deletedAt || e.updatedAt || 0) <= cutoff) {
        storage.hardDelete(table, e.sourceId);
        n++;
      }
    }
  }
  return n;
}

export function newDeleteBatch(): string {
  return genId('del');
}

/** 车辆级联删除：车辆 + 名下全部记录共用批次，30 天内可整批恢复 */
export function deleteCarCascade(storage: StorageAdapter, carId: string): boolean {
  const car = storage.get<any>('cars', carId);
  if (!car || car.deleted) return false;
  const batch = newDeleteBatch();
  storage.softDelete('cars', carId, batch);
  for (const table of CAR_CHILD_TABLES) {
    for (const e of storage.list<any>(table)) {
      if (e.deleted || e.carSourceId !== carId) continue;
      if (table === 'fuelConsumptions') storage.hardDelete(table, e.sourceId);
      else storage.softDelete(table, e.sourceId, batch);
    }
  }
  return true;
}
