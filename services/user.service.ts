// 用户服务：偏好/会员读写
import { StorageAdapter } from '../repositories/storage.adapter';
import { User } from '../types/models';

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

/** 设置置顶车辆（传 '' 取消置顶） */
export function setPinnedCarId(storage: StorageAdapter, carId: string): void {
  const user = storage.getUser();
  if (!user) return;
  user.pinnedCarId = carId;
  user.updatedAt = Date.now();
  storage.setUser(user);
}

export interface MemberView {
  level: 'free' | 'pro';
  expireText: string; // '' 表示未开通
}

export function getMemberView(storage: StorageAdapter): MemberView {
  const user = storage.getUser();
  if (!user || user.memberLevel !== 'pro') return { level: 'free', expireText: '' };
  const expired = user.memberExpireAt > 0 && user.memberExpireAt < Date.now();
  if (expired) return { level: 'free', expireText: '' };
  const d = new Date(user.memberExpireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    level: 'pro',
    expireText: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 到期`
  };
}
