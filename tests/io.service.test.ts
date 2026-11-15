// 数据导入导出单测：往返无损 + 合并
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, getCar } from '../services/car.service';
import { saveRefuel, listRefuels } from '../services/refuel.service';
import { exportBundle, importBundle } from '../services/io.service';
import { addCategory, listCategories, removeCategory } from '../services/cost.service';
import { setPinnedCarId } from '../services/user.service';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

describe('io.service 导出导入', () => {
  it('导出后导入到空库：数据往返无损，区间与里程重算', () => {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const car = createCar(a, { name: 'CRV', mileages: 575, initDate: Date.now(), energyType: 'fuel' });
    saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 4, 24).getTime(),
      makeMileages: 16,
      unitPrice: 7.79,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: true
    });
    saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: new Date(2026, 5, 13).getTime(),
      makeMileages: 575,
      unitPrice: 8.37,
      volume: 33.65,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false
    });

    const json = exportBundle(a);

    const b = new StorageAdapter(createMemoryStorage());
    const result = importBundle(b, json);
    expect(result.ok).toBe(true);
    expect(b.list<any>('cars').filter(c => !c.deleted).length).toBe(1);
    expect(listRefuels(b, car.sourceId).length).toBe(2);
    expect(b.list<any>('fuelConsumptions').filter(c => !c.deleted).length).toBe(1);
    expect(getCar(b, car.sourceId)!.mileages).toBe(575);
  });

  it('导入非法 JSON / 非法格式返回失败', () => {
    const b = new StorageAdapter(createMemoryStorage());
    expect(importBundle(b, 'not json').ok).toBe(false);
    expect(importBundle(b, '{"format":"other"}').ok).toBe(false);
  });
});

describe('F-03 导入校验与异常兜底', () => {
  const manifest = (data: Record<string, unknown>) =>
    JSON.stringify({ format: 'icar-export', version: 1, data });

  it('非数组表 / 缺 data / 非对象根 一律返回失败', () => {
    const b = new StorageAdapter(createMemoryStorage());
    expect(importBundle(b, manifest({ cars: 'oops' })).ok).toBe(false);
    expect(importBundle(b, manifest({ cars: { a: 1 } })).ok).toBe(false);
    expect(importBundle(b, '{"format":"icar-export"}').ok).toBe(false);
    expect(importBundle(b, '[]').ok).toBe(false);
    expect(importBundle(b, 'null').ok).toBe(false);
  });

  it('deleted:true 与非法条目被跳过，不抛异常', () => {
    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    const json = manifest({
      repairRecords: [
        { sourceId: 'mp:repair:good', content: '换刹车片', deleted: false, updatedAt: 1 },
        { sourceId: 'mp:repair:gone', content: '已删', deleted: true, updatedAt: 99 },
        null,
        'bad',
        { content: '无 id' }
      ],
      costs: null
    });
    const result = importBundle(b, json);
    expect(result.ok).toBe(true);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(4);
    expect(b.get<any>('repairRecords', 'mp:repair:good')).not.toBeNull();
    expect(b.get<any>('repairRecords', 'mp:repair:gone')).toBeNull();
  });
});

describe('导入方式：合并 / 覆盖', () => {
  function buildSource() {
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const car = createCar(a, {
      name: '备份车',
      mileages: 1000,
      initDate: Date.now(),
      energyType: 'fuel'
    });
    addCategory(a, '备份独有', '🧾');
    return { adapter: a, car, bundle: exportBundle(a) };
  }

  function buildTarget() {
    const b = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(b);
    addCategory(b, '本机独有', '🧾');
    return b;
  }

  it('合并：本机多余记录保留，备份记录并入', () => {
    const { bundle } = buildSource();
    const b = buildTarget();

    const r = importBundle(b, bundle, 'merge');
    expect(r.ok).toBe(true);
    expect(r.cleared).toBe(0);

    const names = listCategories(b).map(c => c.name);
    expect(names).toContain('本机独有');
    expect(names).toContain('备份独有');
  });

  it('覆盖：本机多余记录被清掉，只剩备份内容', () => {
    const { bundle } = buildSource();
    const b = buildTarget();

    const r = importBundle(b, bundle, 'replace');
    expect(r.ok).toBe(true);
    expect(r.cleared).toBeGreaterThan(0);

    const names = listCategories(b).map(c => c.name);
    expect(names).not.toContain('本机独有');
    expect(names).toContain('备份独有');
  });

  it('覆盖：被用户删过的预设不会被 seed 重新建出来', () => {
    // 备份来源里用户删掉了「洗车」
    const a = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(a);
    const wash = listCategories(a).find(c => c.name === '洗车')!;
    removeCategory(a, wash.sourceId);
    const bundle = exportBundle(a);

    const b = buildTarget();
    // 本机（全新设备）启动时 seed 出来了「洗车」，覆盖导入应把它清掉
    expect(listCategories(b).some(c => c.name === '洗车')).toBe(true);

    importBundle(b, bundle, 'replace');

    expect(listCategories(b).some(c => c.name === '洗车')).toBe(false);
  });

  it('覆盖：本机 user 属性不被备份覆盖（会员 / 置顶 / 已初始化标记）', () => {
    const { bundle } = buildSource();
    const b = buildTarget();
    setPinnedCarId(b, 'keep-me');
    const before = b.getUser()!;

    importBundle(b, bundle, 'replace');

    const after = b.getUser()!;
    expect(after.pinnedCarId).toBe('keep-me');
    expect(after.categoriesSeeded).toBe(true);
    expect(after.memberLevel).toBe(before.memberLevel);
  });

  it('覆盖：车辆数据完整写入并重建派生数据', () => {
    const { bundle, car } = buildSource();
    const b = buildTarget();

    importBundle(b, bundle, 'replace');

    const cars = b.list('cars').filter((c: any) => !c.deleted);
    expect(cars.length).toBe(1);
    expect((cars[0] as any).name).toBe('备份车');
    expect(getCar(b, car.sourceId)).toBeTruthy();
  });

  it('默认（不传 mode）仍是合并，兼容既有调用', () => {
    const { bundle } = buildSource();
    const b = buildTarget();
    const r = importBundle(b, bundle);
    expect(r.ok).toBe(true);
    expect(r.cleared).toBe(0);
    expect(listCategories(b).some(c => c.name === '本机独有')).toBe(true);
  });
});
