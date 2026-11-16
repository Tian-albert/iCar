// 清除所有数据（不可撤销）
//
// 与「回收站」不同：回收站是软删（deleted=true，30 天内可恢复），
// 这里是**物理清空**——业务表、回收站内容、自定义图标登记表全部删掉。
//
// 保留的东西（有意为之）：
// - `user`：会员状态、提醒开关、置顶车等本机偏好；尤其 `categoriesSeeded`
//   一旦清掉，下次启动会把用户删过的预设类别重新建出来
// - `meta`：schemaVersion，清掉会触发重复迁移
import { StorageAdapter } from '../repositories/storage.adapter';
import { TABLES } from '../store/index';

/** 会被清空的表（全部业务表 + 派生表 + 图标登记表） */
const PURGE_TABLES: string[] = [
  TABLES.cars,
  TABLES.categories,
  TABLES.maintains,
  TABLES.maintainHandles,
  TABLES.maintainLogs,
  TABLES.costs,
  TABLES.repairRecords,
  TABLES.fuelRecords,
  TABLES.fuelConsumptions,
  TABLES.customIcons
];

export interface ClearAllResult {
  ok: boolean;
  /** 被删除的记录总数 */
  removed: number;
  message?: string;
}

/**
 * 物理清空所有业务数据。
 *
 * 逐个 `hardDelete` 而不是清 storage key：`StorageAdapter` 维护着
 * `table -> sourceId[]` 索引，直接删 key 会让索引留下悬空 id，
 * 之后 `list()` 会返回 undefined 项。
 */
export function clearAllData(storage: StorageAdapter): ClearAllResult {
  let removed = 0;
  try {
    for (const table of PURGE_TABLES) {
      // 用 list 拿全量（含已软删的回收站记录），逐个物理删除
      for (const entity of storage.list<{ sourceId: string }>(table)) {
        if (!entity || !entity.sourceId) continue;
        storage.hardDelete(table, entity.sourceId);
        removed++;
      }
    }
    return { ok: true, removed };
  } catch (e) {
    return {
      ok: false,
      removed,
      message: '清除过程中发生错误，部分数据可能已被删除'
    };
  }
}
