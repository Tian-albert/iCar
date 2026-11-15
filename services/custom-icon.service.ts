// 自定义图标登记表
//
// 为什么需要单独登记：用户裁剪出的图标文件落在沙盒里，但「选择器」无法反查
// 沙盒里哪些文件是用户上传的——只能靠一张表记住。这张表同时充当
// 「自定义分栏」的数据源。
//
// 不参与数据导出：导出的只是 wxfile:// 路径，换设备后文件并不存在，
// 带过去只会得到一堆点不开的空白图标。
import { StorageAdapter } from '../repositories/storage.adapter';
import { BaseEntity } from '../types/models';
import { genId } from '../utils/id';

export const CUSTOM_ICON_TABLE = 'customIcons';

export interface CustomIcon extends BaseEntity {
  /** 沙盒内的文件路径 */
  path: string;
}

/** 登记一个自定义图标；同一路径不重复登记 */
export function addCustomIcon(storage: StorageAdapter, path: string): CustomIcon | null {
  if (!path) return null;

  const exists = storage
    .list<CustomIcon>(CUSTOM_ICON_TABLE)
    .filter(e => !e.deleted && e.path === path)[0];
  if (exists) return exists;

  const now = Date.now();
  const entity: CustomIcon = {
    sourceId: genId('custom-icon'),
    sourcePlatform: 'mp',
    path,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  return storage.insert(CUSTOM_ICON_TABLE, entity);
}

/** 全部自定义图标路径，最新的在前 */
export function listCustomIconPaths(storage: StorageAdapter): string[] {
  return storage
    .list<CustomIcon>(CUSTOM_ICON_TABLE)
    .filter(e => !e.deleted && !!e.path)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(e => e.path);
}

/**
 * 移除登记。
 *
 * 用物理删除而非软删：图标登记不是业务数据，放进回收站只会让用户
 * 看到一堆「自定义图标」条目，且恢复后仍是同一个文件，没有价值。
 * 文件本身交给启动时的孤儿清理回收。
 */
export function removeCustomIcon(storage: StorageAdapter, path: string): void {
  for (const e of storage.list<CustomIcon>(CUSTOM_ICON_TABLE)) {
    if (!e.deleted && e.path === path) {
      storage.hardDelete(CUSTOM_ICON_TABLE, e.sourceId);
    }
  }
}

/**
 * 统计某个图标被多少条业务数据引用。
 *
 * 删除登记前必须先查：若仍有实体在用这个路径，删掉登记并不会让它变回默认图标，
 * 而是留下一个指向已删文件的孤立引用——UI 上表现为裂图。
 */
export function countIconUsage(storage: StorageAdapter, path: string): number {
  if (!path) return 0;
  const tables = ['cars', 'categories', 'maintains'];
  let count = 0;
  for (const table of tables) {
    for (const e of storage.list<{ deleted?: boolean; icon?: string }>(table)) {
      if (!e.deleted && e.icon === path) count++;
    }
  }
  return count;
}

/** 是否已登记（供启动清理判断文件是否有主） */
export function listRegisteredPaths(storage: StorageAdapter): string[] {
  return storage
    .list<CustomIcon>(CUSTOM_ICON_TABLE)
    .filter(e => !e.deleted && !!e.path)
    .map(e => e.path);
}
