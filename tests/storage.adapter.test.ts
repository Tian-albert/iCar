import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { runMigrations } from '../repositories/migration';
import { Car, User } from '../types/models';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

const baseCar: Car = {
  sourceId: 'mp:cars:1',
  sourcePlatform: 'mp',
  name: 'CRV',
  type: 'car',
  icon: 'car',
  customIconAssetId: '',
  initDate: 1779552000000,
  initMileages: 0,
  mileages: 2908,
  evMileages: 0,
  hevMileages: 0,
  batteryCapacity: 0,
  energyType: 'fuel',
  energyTrackingEnabled: true,
  maintainSoonMileage: 500,
  maintainSoonDays: 15,
  createdAt: 0,
  updatedAt: 0,
  deleted: false
};

describe('StorageAdapter 记录级读写', () => {
  it('insert + list + get + softDelete', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    adapter.insert('cars', baseCar);
    expect(adapter.get<Car>('cars', 'mp:cars:1')?.name).toBe('CRV');
    expect(adapter.list<Car>('cars').length).toBe(1);

    adapter.softDelete('cars', 'mp:cars:1');
    expect(adapter.get<Car>('cars', 'mp:cars:1')?.deleted).toBe(true);
  });

  it('rebuildIndex 从实体 key 重建索引（孤儿实体补入）', () => {
    const storage = createMemoryStorage();
    const adapter = new StorageAdapter(storage);
    // 直接写实体 key，不经过 insert，模拟"记录已写、索引未写"
    storage.set('icar:cars:mp:cars:2', baseCar);
    adapter.rebuildIndex();
    expect(adapter.getIndex()['cars']).toContain('mp:cars:2');
  });
});

describe('migration 迁移', () => {
  it('v1 -> v1.2：创建默认 User 并回填 Car.initMileages', () => {
    const storage = createMemoryStorage();
    const adapter = new StorageAdapter(storage);
    // 写入一条"旧格式"车辆（无 initMileages 字段）
    const legacyCar = { ...baseCar } as any;
    delete legacyCar.initMileages;
    adapter.insert('cars', legacyCar);

    const version = runMigrations(adapter);

    expect(version).toBeGreaterThanOrEqual(3); // v1 -> v1.1 -> v1.2 => 版本 3
    const user = adapter.getUser();
    expect(user).not.toBeNull();
    expect(user!.remindEnabled).toBe(true);
    expect(user!.memberLevel).toBe('free');

    const migrated = adapter.get<Car>('cars', 'mp:cars:1');
    expect(migrated!.initMileages).toBe(0);
  });
});
