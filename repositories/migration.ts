// Schema 迁移（设计报告 4.6）：按 meta.schemaVersion 逐版本执行
import { Car, User } from '../types/models';
import { StorageAdapter } from './storage.adapter';

type UserSeed = Omit<User, 'sourceId' | 'sourcePlatform' | 'createdAt' | 'updatedAt' | 'deleted'>;

const DEFAULT_USER: UserSeed = {
  openid: '',
  nickname: '',
  avatarUrl: '',
  remindEnabled: true,
  reminderSentCount: 0,
  memberLevel: 'free',
  memberExpireAt: 0,
  appLockEnabled: false,
  appLockPin: '',
  lastPulledAt: 0,
  pinnedCarId: ''
};

/** v1 -> v1.1：新增 User 实体 */
function migrate_v1_to_v11(adapter: StorageAdapter): void {
  if (!adapter.getUser()) {
    adapter.setUser({
      ...DEFAULT_USER,
      sourceId: 'mp:user:default',
      sourcePlatform: 'mp',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    });
  }
}

/** v1.1 -> v1.2：Car 回填 initMileages = 0 */
function migrate_v11_to_v12(adapter: StorageAdapter): void {
  const cars = adapter.list<Car>('cars');
  for (const car of cars) {
    if (car.initMileages === undefined || car.initMileages === null) {
      car.initMileages = 0;
      car.updatedAt = Date.now();
      adapter.update('cars', car);
    }
  }
}

/** v1.2 -> v1.3：Car 回填保养提醒阈值（默认 500km / 15 天） */
function migrate_v12_to_v13(adapter: StorageAdapter): void {
  const cars = adapter.list<Car>('cars');
  for (const car of cars) {
    let changed = false;
    if (car.maintainSoonMileage === undefined || car.maintainSoonMileage === null) {
      car.maintainSoonMileage = 500;
      changed = true;
    }
    if (car.maintainSoonDays === undefined || car.maintainSoonDays === null) {
      car.maintainSoonDays = 15;
      changed = true;
    }
    if (changed) {
      car.updatedAt = Date.now();
      adapter.update('cars', car);
    }
  }
}

/** v1.3 -> v1.4：User 回填置顶车辆字段 */
function migrate_v13_to_v14(adapter: StorageAdapter): void {
  const user = adapter.getUser();
  if (!user) return;
  if (user.pinnedCarId === undefined || user.pinnedCarId === null) {
    user.pinnedCarId = '';
    user.updatedAt = Date.now();
    adapter.setUser(user);
  }
}

const MIGRATIONS: Array<(adapter: StorageAdapter) => void> = [
  migrate_v1_to_v11,
  migrate_v11_to_v12,
  migrate_v12_to_v13,
  migrate_v13_to_v14
];

/** 启动时执行全部待迁移版本；返回迁移到的目标版本号 */
export function runMigrations(adapter: StorageAdapter): number {
  const meta = adapter.getMeta<{ schemaVersion?: number }>();
  let current = meta.schemaVersion ?? 1; // 旧数据默认按 v1
  for (let i = current - 1; i < MIGRATIONS.length; i++) {
    MIGRATIONS[i](adapter);
    current = i + 2; // 版本号从 1 起，迁移函数索引 0 对应 v1->v1.1
  }
  adapter.setMeta({ ...meta, schemaVersion: current });
  return current;
}

/** 当前最新 schema 版本 */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.length + 1;
