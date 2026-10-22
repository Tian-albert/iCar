// 本地存储适配层（设计报告 4.4）
// 纯接口 + 逻辑，不依赖 wx，便于 Jest 测试；wx 绑定见 wx-storage.ts
import { BaseEntity, User } from '../types/models';

/** 可注入的键值存储（小程序端用 wx 实现，测试用内存实现） */
export interface StorageLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): string[];
}

export const KEY_INDEX = 'icar:index';
export const KEY_USER = 'icar:user';
export const KEY_META = 'icar:meta';

/** 索引结构：table -> sourceId[] */
export type TableIndex = Record<string, string[]>;

function tableKey(table: string, id: string): string {
  return `icar:${table}:${id}`;
}

function tableOfKey(key: string): string | null {
  if (!key.startsWith('icar:')) return null;
  const rest = key.slice('icar:'.length);
  if (rest === 'index' || rest === 'user' || rest === 'meta') return null;
  // sourceId 自身含冒号（如 mp:cars:2），故按第一个冒号切分表名
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  return rest.slice(0, sep);
}

export class StorageAdapter {
  constructor(private storage: StorageLike) {}

  // ---------- 索引 ----------
  getIndex(): TableIndex {
    const v = this.storage.get(KEY_INDEX);
    return (v && typeof v === 'object' ? v : {}) as TableIndex;
  }

  private saveIndex(index: TableIndex): void {
    this.storage.set(KEY_INDEX, index);
  }

  private addToIndex(table: string, id: string): void {
    const index = this.getIndex();
    const ids = index[table] ?? [];
    if (!ids.includes(id)) {
      ids.push(id);
      index[table] = ids;
      this.saveIndex(index);
    }
  }

  private removeFromIndex(table: string, id: string): void {
    const index = this.getIndex();
    if (index[table]) {
      index[table] = index[table].filter(x => x !== id);
      this.saveIndex(index);
    }
  }

  // ---------- 通用记录读写 ----------
  insert<T extends BaseEntity>(table: string, entity: T): T {
    this.storage.set(tableKey(table, entity.sourceId), entity);
    this.addToIndex(table, entity.sourceId);
    return entity;
  }

  get<T>(table: string, id: string): T | null {
    const v = this.storage.get(tableKey(table, id));
    return (v && typeof v === 'object' ? (v as T) : null);
  }

  list<T>(table: string): T[] {
    const ids = this.getIndex()[table] ?? [];
    const result: T[] = [];
    for (const id of ids) {
      const e = this.get<T>(table, id);
      if (e) result.push(e);
    }
    return result;
  }

  update<T extends BaseEntity>(table: string, entity: T): T {
    this.storage.set(tableKey(table, entity.sourceId), entity);
    this.addToIndex(table, entity.sourceId);
    return entity;
  }

  softDelete(table: string, id: string): void {
    const e = this.get<BaseEntity>(table, id);
    if (e) {
      e.deleted = true;
      e.updatedAt = Date.now();
      this.storage.set(tableKey(table, id), e);
    }
  }

  /** 物理删除（用于派生数据如 FuelConsumption 的重建覆盖） */
  hardDelete(table: string, id: string): void {
    this.storage.remove(tableKey(table, id));
    this.removeFromIndex(table, id);
  }

  // ---------- User 单例 ----------
  getUser(): User | null {
    const v = this.storage.get(KEY_USER);
    return (v && typeof v === 'object' ? (v as User) : null);
  }

  setUser(user: User): void {
    this.storage.set(KEY_USER, user);
  }

  // ---------- meta ----------
  getMeta<T = Record<string, unknown>>(): T {
    const v = this.storage.get(KEY_META);
    return (v && typeof v === 'object' ? (v as T) : ({} as T));
  }

  setMeta(meta: Record<string, unknown>): void {
    this.storage.set(KEY_META, meta);
  }

  /**
   * 启动对账（设计报告 4.4 / 7.7）：
   * 扫描全部 icar:<table>:<id> key，重建索引；索引缺失但实体存在则补入，
   * 实体已物理删除但索引残留则剔除。
   */
  rebuildIndex(): void {
    const index: TableIndex = {};
    for (const key of this.storage.keys()) {
      const table = tableOfKey(key);
      if (!table) continue;
      if (!this.storage.get(key)) continue; // 跳过无效 key
      (index[table] ??= []).push(key.slice(`icar:${table}:`.length));
    }
    // 各表 id 排序，保证导出幂等
    for (const table of Object.keys(index)) {
      index[table].sort();
    }
    this.saveIndex(index);
  }
}
