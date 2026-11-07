// 车辆服务单测：新建 + 编辑（F-05）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { createCar, updateCar, getCar } from '../services/car.service';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

describe('car.service 车辆编辑', () => {
  it('编辑名称 / 初始里程 / 购车日期 / 图标，不改能量类型', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    const car = createCar(adapter, {
      name: 'CRV',
      mileages: 100,
      initDate: new Date(2026, 0, 1).getTime(),
      energyType: 'fuel',
      icon: 'car'
    });
    const newDate = new Date(2026, 5, 1).getTime();
    const updated = updateCar(adapter, car.sourceId, {
      name: '我的 CRV',
      initMileages: 300,
      initDate: newDate,
      icon: '🚙'
    });

    expect(updated).not.toBeNull();
    const after = getCar(adapter, car.sourceId)!;
    expect(after.name).toBe('我的 CRV');
    expect(after.initMileages).toBe(300);
    expect(after.initDate).toBe(newDate);
    expect(after.icon).toBe('🚙');
    expect(after.energyType).toBe('fuel');
    // Q8 / F-05 只授权改四个字段；当前里程由加油记录回写，编辑车辆不得顺带改写
    expect(after.mileages).toBe(100);
  });

  it('车辆不存在时返回 null', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    expect(
      updateCar(adapter, 'missing', {
        name: 'x',
        initMileages: 0,
        initDate: 0,
        icon: 'car'
      })
    ).toBeNull();
  });
});
