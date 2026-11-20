// SKILL 分包内的存储访问层（**手写**，不复用主包 repositories）
//
// 为什么手写：SKILL 必须在独立分包里，独立分包按微信分包规则不依赖主包，
// 主包的 StorageAdapter 无法 require 进来。
//
// 为什么敢手写：主包 `repositories/storage.adapter.ts` 的落盘格式非常简单且稳定——
//   · 索引        icar:index            → { [table]: sourceId[] }
//   · 单条记录    icar:{table}:{id}     → 实体本身
//   · 用户单例    icar:user
// 这里只实现只读 + 简单写入所需的最小集合，不碰迁移、种子、软删批次等主包职责。
// 口径一致性由 `tests/skill-lib-sync.test.ts` 与接口契约测试兜底。
import {
  Car,
  Category,
  Cost,
  FuelConsumption,
  Maintain,
  MaintainHandle,
  MaintainLog,
  RefuelLog,
  User
} from '../lib/types/models';

const KEY_INDEX = 'icar:index';
const KEY_USER = 'icar:user';

export interface TableIndex {
  [table: string]: string[];
}

function readIndex(): TableIndex {
  try {
    const v = wx.getStorageSync(KEY_INDEX);
    return v && typeof v === 'object' ? (v as TableIndex) : {};
  } catch (e) {
    // 存储异常时按空库处理：AI 侧宁可回答「没有数据」，也不能抛错中断对话
    return {};
  }
}

/** 读一张表的全部未删除记录 */
export function list<T>(table: string): T[] {
  const ids = readIndex()[table] || [];
  const out: T[] = [];
  for (const id of ids) {
    try {
      const v = wx.getStorageSync(`icar:${table}:${id}`);
      if (v && typeof v === 'object' && !(v as { deleted?: boolean }).deleted) {
        out.push(v as T);
      }
    } catch (e) {
      // 单条损坏不影响整表
    }
  }
  return out;
}

/** 写入一条记录并维护索引（与主包 StorageAdapter.insert 行为一致） */
export function insert<T extends { sourceId: string }>(table: string, entity: T): T {
  wx.setStorageSync(`icar:${table}:${entity.sourceId}`, entity);
  const index = readIndex();
  const ids = index[table] || [];
  if (!ids.includes(entity.sourceId)) {
    ids.push(entity.sourceId);
    index[table] = ids;
    wx.setStorageSync(KEY_INDEX, index);
  }
  return entity;
}

/** 按 id 取单条（含已删除的，由调用方判断 deleted） */
export function get<T>(table: string, id: string): T | null {
  try {
    const v = wx.getStorageSync(`icar:${table}:${id}`);
    return v && typeof v === 'object' ? (v as T) : null;
  } catch (e) {
    return null;
  }
}

/** 覆盖更新（记录必须已存在，索引不变） */
export function update<T extends { sourceId: string }>(table: string, entity: T): T {
  wx.setStorageSync(`icar:${table}:${entity.sourceId}`, entity);
  return entity;
}

/**
 * 物理删除（不写回收站）。
 *
 * 只用于「可重算的派生数据」——目前只有 `fuelConsumptions`：
 * 油耗区间由加油记录全量重算得出，留着旧区间会与新记录打架；
 * 用户真正在乎的记录（加油、支出）一律走软删。
 */
export function hardDelete(table: string, id: string): void {
  try {
    wx.removeStorageSync(`icar:${table}:${id}`);
    const index = readIndex();
    if (index[table]) {
      index[table] = index[table].filter(x => x !== id);
      wx.setStorageSync(KEY_INDEX, index);
    }
  } catch (e) {
    // 删除失败不影响主流程：区间会在下次重算时被覆盖
  }
}

export function getUser(): User | null {
  try {
    const v = wx.getStorageSync(KEY_USER);
    return v && typeof v === 'object' ? (v as User) : null;
  } catch (e) {
    return null;
  }
}

export const readCars = (): Car[] => list<Car>('cars');
export const readCategories = (): Category[] => list<Category>('categories');
export const readCosts = (): Cost[] => list<Cost>('costs');
/** 加油/充电记录（主包表名是 fuelRecords，不是 refuels） */
export const readRefuels = (): RefuelLog[] => list<RefuelLog>('fuelRecords');
/** 油耗/电耗区间（主包表名 fuelConsumptions） */
export const readConsumptions = (): FuelConsumption[] => list<FuelConsumption>('fuelConsumptions');
export const readMaintains = (): Maintain[] => list<Maintain>('maintains');
export const readHandles = (): MaintainHandle[] => list<MaintainHandle>('maintainHandles');
export const readLogs = (): MaintainLog[] => list<MaintainLog>('maintainLogs');

/**
 * 选车：显式指定 > 置顶车 > 第一辆车。
 *
 * 模糊匹配（contains）而不是全等：用户口语说「我的 CRV」，库里的名字是「我的 CRV 2021」。
 */
export function pickCar(cars: Car[], carName: string): Car | null {
  if (!cars.length) return null;
  const key = (carName || '').trim();
  if (key) {
    const exact = cars.find(c => c.name === key);
    if (exact) return exact;
    const fuzzy = cars.find(c => c.name.includes(key) || key.includes(c.name));
    if (fuzzy) return fuzzy;
  }
  const pinnedId = getUser()?.pinnedCarId;
  if (pinnedId) {
    const pinned = cars.find(c => c.sourceId === pinnedId);
    if (pinned) return pinned;
  }
  return cars[0];
}

/** 车型的中文口径（回答里要说人话，不能直接甩 fuel / ev） */
export function energyLabel(car: Car): string {
  if (car.energyType === 'ev') return '纯电';
  if (car.energyType === 'hybrid') return '混动';
  return '燃油';
}
