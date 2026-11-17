// 用户服务：偏好/会员读写
import { StorageAdapter } from '../repositories/storage.adapter';
import { User } from '../types/models';

/** 取本机用户偏好；从未初始化时返回 `null`（查询类不抛错，调用方给默认值） */
export function getUser(storage: StorageAdapter): User | null {
  return storage.getUser();
}

export function setRemindEnabled(storage: StorageAdapter, enabled: boolean): void {
  const user = storage.getUser();
  if (!user) return;
  user.remindEnabled = enabled;
  user.updatedAt = Date.now();
  storage.setUser(user);
}

/** 读取置顶车辆 id（'' 表示未置顶） */
export function getPinnedCarId(storage: StorageAdapter): string {
  return storage.getUser()?.pinnedCarId ?? '';
}

/**
 * 设置置顶车辆（传 '' 取消置顶）。
 *
 * user 记录正常由迁移创建；但若缺失（如导入异常数据后），原实现直接 return
 * 会静默失败 —— 用户点置顶毫无反应且不报错。这里改为缺则补建，保证操作生效。
 */
export function setPinnedCarId(storage: StorageAdapter, carId: string): void {
  const existing = storage.getUser();
  const user: User =
    existing ||
    ({
      sourceId: 'user-local',
      sourcePlatform: 'mp',
      remindEnabled: true,
      pinnedCarId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as User);
  user.pinnedCarId = carId;
  user.updatedAt = Date.now();
  storage.setUser(user);
}


