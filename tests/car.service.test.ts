// 车辆服务单测：新建 + 编辑（F-05）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { createCar, updateCar, getCar, syncMileages } from '../services/car.service';

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
      icon: '🚙',
      energyType: 'ev',
      batteryCapacity: 60
    });

    expect(updated).not.toBeNull();
    const after = getCar(adapter, car.sourceId)!;
    expect(after.name).toBe('我的 CRV');
    expect(after.initMileages).toBe(300);
    expect(after.initDate).toBe(newDate);
    expect(after.icon).toBe('🚙');
    // R-07：能量类型与电池容量可在编辑页修改
    expect(after.energyType).toBe('ev');
    expect(after.batteryCapacity).toBe(60);
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
        icon: 'car',
        energyType: 'fuel',
        batteryCapacity: 0
      })
    ).toBeNull();
  });
});

describe('car.service 里程回写（R-01）', () => {
  const mkHandle = (id: string, carId: string, mileage: number) =>
    ({ sourceId: id, carSourceId: carId, makeMileages: mileage, deleted: false } as any);
  const mkRepair = (id: string, carId: string, mileage: number) =>
    ({ sourceId: id, carSourceId: carId, mileage, deleted: false } as any);
  const setupCar = () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    const car = createCar(adapter, {
      name: 'CRV',
      mileages: 100,
      initDate: Date.now(),
      energyType: 'fuel'
    });
    return { adapter, car };
  };

  it('保养执行 / 维修里程纳入当前里程', () => {
    const { adapter, car } = setupCar();
    adapter.insert('maintainHandles', mkHandle('h1', car.sourceId, 800));
    adapter.insert('repairRecords', mkRepair('r1', car.sourceId, 500));
    syncMileages(adapter, car.sourceId);
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(800);
  });

  it('补录历史里程（小于当前）不让里程倒退', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    const car = createCar(adapter, {
      name: 'CRV',
      mileages: 2908,
      initDate: Date.now(),
      energyType: 'fuel'
    });
    adapter.insert('maintainHandles', mkHandle('h1', car.sourceId, 1534));
    syncMileages(adapter, car.sourceId);
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(2908);
  });

  it('删除记录时允许回退到建档里程', () => {
    const { adapter, car } = setupCar();
    adapter.insert('repairRecords', mkRepair('r1', car.sourceId, 500));
    syncMileages(adapter, car.sourceId);
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(500);

    adapter.softDelete('repairRecords', 'r1');
    syncMileages(adapter, car.sourceId, true);
    expect(getCar(adapter, car.sourceId)!.mileages).toBe(100);
  });
});
