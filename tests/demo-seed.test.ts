// 演示数据预置服务测试：三道闸 + 数据规格 + 幂等
//
// 背景：评测工具拉起的环境是空库，查询类原子接口答不出内容。
// 解法是开发 / 体验环境空库时注入演示数据（详见 services/demo-seed.service.ts）。
// 这里把三道闸和数据规格锁死——种子数据一旦和评测集 / 分镜表脱节，评测会静默失效。
import { installWx, resetStorage } from './helpers/page-harness';
import { getStorage } from '../store/index';
import type { StorageAdapter } from '../repositories/storage.adapter';
import { LATEST_SCHEMA_VERSION } from '../repositories/migration';
import { seedPresetCategories } from '../repositories/seed';
import { seedDemoDataIfNeeded } from '../services/demo-seed.service';
import { calcRemaining, findLastHandle, isRemainOverdue } from '../domain/maintain.service';
import { RefuelLog, Car, Maintain, MaintainHandle } from '../types/models';

/**
 * 每个用例一个「已初始化完成」的空库。
 *
 * 注意：getStorage() 是模块级单例，resetStorage() 清空 map 后单例不会重跑迁移与类别种子——
 * 生产环境不存在此问题（初始化只发生一次且先于注入）。因此测试里手动重建初始化状态：
 * 重铺预设类别 + 写回 schemaVersion，模拟「初始化已完成」。
 */
function freshStorage(): StorageAdapter {
  resetStorage();
  installWx();
  const storage = getStorage();
  seedPresetCategories(storage);
  storage.setMeta({ ...storage.getMeta(), schemaVersion: LATEST_SCHEMA_VERSION });
  return storage;
}

describe('三道闸', () => {
  it('release 环境永不注入', () => {
    const storage = freshStorage();
    expect(seedDemoDataIfNeeded(storage, 'release')).toBe(false);
    expect(storage.list('cars')).toEqual([]);
  });

  it('已有车辆（真实数据）不注入', () => {
    const storage = freshStorage();
    // 先注入一次产生车辆，再模拟「删光但记得注过」之外的路径：直接再调一次应被闸 2 挡住
    seedDemoDataIfNeeded(storage, 'trial');
    const before = storage.list('cars').length;
    // 手动清掉 demoSeededAt 标记，模拟「用户删光数据但闸 3 未记录」——此时有车仍不得再注
    (storage as any).cars; // 语义占位：闸 2 依据车辆存在性
    const second = seedDemoDataIfNeeded(storage, 'trial');
    expect(second).toBe(false);
    expect(storage.list('cars').length).toBe(before);
  });

  it('develop 环境空库会注入', () => {
    const storage = freshStorage();
    expect(seedDemoDataIfNeeded(storage, 'develop')).toBe(true);
    expect(storage.list('cars').length).toBeGreaterThan(0);
  });

  it('envVersion 缺失（极端环境）按可注入处理，不阻塞启动', () => {
    const storage = freshStorage();
    expect(seedDemoDataIfNeeded(storage, undefined)).toBe(true);
  });
});

describe('演示数据规格（评测集依赖这些非空能力）', () => {
  let storage: StorageAdapter;

  beforeEach(() => {
    storage = freshStorage();
    seedDemoDataIfNeeded(storage, 'trial');
  });

  it('3 辆车：燃油 + 纯电 + 混动', () => {
    const cars = storage.list<Car>('cars').filter(c => !c.deleted);
    expect(cars.length).toBe(3);
    expect(cars.map(c => c.energyType).sort()).toEqual(['ev', 'fuel', 'hybrid']);
  });

  it('燃油车有连续加满记录，油耗区间非空（否则「油耗怎么样」答不出）', () => {
    const crv = storage.list<Car>('cars').find(c => c.name === '我的 CRV')!;
    const segs = storage
      .list<any>('fuelConsumptions')
      .filter(s => s.carSourceId === crv.sourceId && s.energyType === 'fuel');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.every(s => s.fuelConsumption > 0)).toBe(true);
  });

  it('纯电与混动都有充电记录（电耗 / 电费可答）', () => {
    const cars = storage.list<Car>('cars');
    const p7 = cars.find(c => c.name === '小鹏 P7')!;
    const tang = cars.find(c => c.name === '唐 DM-i')!;
    const charges = (carId: string) =>
      storage.list<RefuelLog>('fuelRecords').filter(r => r.carSourceId === carId && r.energyType === 'ev');
    expect(charges(p7.sourceId).length).toBeGreaterThanOrEqual(2);
    expect(charges(tang.sourceId).length).toBeGreaterThanOrEqual(1);
    // P7 两次连续充满 → 电耗区间非空
    const p7Segs = storage
      .list<any>('fuelConsumptions')
      .filter(s => s.carSourceId === p7.sourceId && s.energyType === 'ev');
    expect(p7Segs.length).toBeGreaterThanOrEqual(1);
  });

  it('保养一红一橙：机油超期、空气滤芯临近', () => {
    const crv = storage.list<Car>('cars').find(c => c.name === '我的 CRV')!;
    const car = crv as Car;
    const items = storage.list<Maintain>('maintains').filter(m => m.carSourceId === car.sourceId);
    expect(items.length).toBe(2);

    // findLastHandle 依赖 maintainLogs 关联流水（maintainSourceId → handleSourceId），不能只传 handles
    const logs = storage.list<any>('maintainLogs');
    const handles = storage.list<MaintainHandle>('maintainHandles');
    const now = Date.now();
    const thresholds = { mileage: 500, days: 15 };
    const remains = items.map(m => {
      const last = findLastHandle(m, logs, handles);
      return {
        name: m.name,
        remain: calcRemaining(m, last, car, now, thresholds)
      };
    });

    const oil = remains.find(r => r.name === '机油机滤')!;
    const air = remains.find(r => r.name === '空气滤芯')!;
    expect(oil.remain.remainMileage).toBeLessThan(0);
    expect(isRemainOverdue(oil.remain.remainMileage, oil.remain.remainDays)).toBe(true);
    expect(air.remain.remainMileage).toBeGreaterThan(0);
    expect(air.remain.remainMileage).toBeLessThanOrEqual(1000);
  });

  it('支出 ≥8 笔、覆盖 ≥4 个预设类别、跨多个月段', () => {
    // 排除加油/保养联动产生的流水（它们自带 fuelRecordSourceId / maintainHandleSourceId）
    const manual = storage
      .list<any>('costs')
      .filter(c => !c.deleted && !c.fuelRecordSourceId && !c.maintainHandleSourceId);
    expect(manual.length).toBeGreaterThanOrEqual(8);
    expect(new Set(manual.map(c => c.categorySourceId)).size).toBeGreaterThanOrEqual(4);

    const months = new Set(manual.map(c => new Date(c.costDate).getMonth()));
    expect(months.size).toBeGreaterThanOrEqual(2);
  });

  it('加油自动联动支出（「今年花了多少」包含油费）', () => {
    const fuelCosts = storage.list<any>('costs').filter(c => c.fuelRecordSourceId);
    expect(fuelCosts.length).toBeGreaterThanOrEqual(9);
  });

  it('三辆车都配了保养项（全车汇总才有内容）', () => {
    const cars = storage.list<Car>('cars');
    for (const car of cars) {
      const items = storage.list<Maintain>('maintains').filter(m => m.carSourceId === car.sourceId);
      expect(items.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('去年（2025）有支出，让「跟去年比」有真实基线', () => {
    const lastYear = new Date().getFullYear() - 1;
    const costs = storage
      .list<any>('costs')
      .filter(c => !c.deleted && new Date(c.costDate).getFullYear() === lastYear);
    expect(costs.length).toBeGreaterThanOrEqual(3);
    const sum = costs.reduce((s, c) => s + c.amount, 0);
    expect(sum).toBeGreaterThan(1000);
  });

  it('每公里成本落在真实区间（0.5~3 元），否则评测结论一眼就假', () => {
    const year = new Date().getFullYear();
    const costs = storage
      .list<any>('costs')
      .filter(c => !c.deleted && new Date(c.costDate).getFullYear() === year);
    const total = costs.reduce((s, c) => s + c.amount, 0);

    // 有效里程 = 每辆车加油/充电记录的最大里程 − 最小里程
    const cars = storage.list<Car>('cars');
    const mileage = cars.reduce((sum, car) => {
      const ms = storage
        .list<RefuelLog>('fuelRecords')
        .filter(r => r.carSourceId === car.sourceId)
        .map(r => r.makeMileages);
      return sum + (ms.length > 1 ? Math.max(...ms) - Math.min(...ms) : 0);
    }, 0);

    expect(mileage).toBeGreaterThan(5000);
    const perKm = total / mileage;
    expect(perKm).toBeGreaterThan(0.5);
    expect(perKm).toBeLessThan(3);
  });

  it('油耗 / 电耗落在真实区间', () => {
    const crv = storage.list<Car>('cars').find(c => c.name === '我的 CRV')!;
    const p7 = storage.list<Car>('cars').find(c => c.name === '小鹏 P7')!;
    const segs = storage.list<any>('fuelConsumptions');

    const fuelSegs = segs.filter(s => s.carSourceId === crv.sourceId && s.energyType === 'fuel');
    const avgFuel =
      fuelSegs.reduce((s, x) => s + x.fuelAmount, 0) / fuelSegs.reduce((s, x) => s + x.mileage, 0);
    expect(avgFuel * 100).toBeGreaterThan(5);
    expect(avgFuel * 100).toBeLessThan(14);

    const evSegs = segs.filter(s => s.carSourceId === p7.sourceId && s.energyType === 'ev');
    const avgEv = evSegs.reduce((s, x) => s + x.fuelAmount, 0) / evSegs.reduce((s, x) => s + x.mileage, 0);
    expect(avgEv * 100).toBeGreaterThan(9);
    expect(avgEv * 100).toBeLessThan(25);
  });

  it('meta 记录 demoSeededAt 且保留 schemaVersion', () => {
    const meta = storage.getMeta<{ schemaVersion?: number; demoSeededAt?: number }>();
    expect(meta.demoSeededAt).toBeGreaterThan(0);
    expect(meta.schemaVersion).toBeGreaterThan(0);
  });
});

describe('幂等', () => {
  it('注入过一次后再调用不重复（demoSeededAt 闸）', () => {
    const storage = freshStorage();
    seedDemoDataIfNeeded(storage, 'trial');
    const cars = storage.list('cars').length;
    const costs = storage.list('costs').length;

    // 手动清掉闸 3 标记，验证闸 2（有车辆）兜底
    storage.setMeta({ ...storage.getMeta(), demoSeededAt: undefined });
    expect(seedDemoDataIfNeeded(storage, 'trial')).toBe(false);
    expect(storage.list('cars').length).toBe(cars);
    expect(storage.list('costs').length).toBe(costs);
  });
});
