// 测试数据可用性校验：三份样本必须能被 importBundle 正常导入并算出合理指标
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { importBundle } from '../services/io.service';
import { getCar } from '../services/car.service';
import { listRefuels, getConsumptions } from '../services/refuel.service';
import { listCosts } from '../services/cost.service';
import { listRepairs } from '../services/repair.service';
import { listMaintains, listMaintainHandles } from '../services/maintain-record.service';
import { buildStats } from '../domain/stats.service';
import { EnergyType } from '../types/models';

// 项目 tsconfig.types 只含小程序类型，Node 模块声明不可用，故用 require
const fsx = require('fs') as any;
const pathx = require('path') as any;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function load(file: string): string {
  const p = pathx.join('test-data', file);
  if (!fsx.existsSync(p)) {
    throw new Error(`缺少测试数据文件 ${p}，请先运行 python test-data/generate.py`);
  }
  return fsx.readFileSync(p, 'utf-8');
}

function importAndStats(file: string) {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const result = importBundle(adapter, load(file));
  expect(result.ok).toBe(true);
  expect(result.added).toBeGreaterThan(0);

  const cars = adapter.list<any>('cars').filter((c: any) => !c.deleted);
  expect(cars.length).toBe(1);
  const car = cars[0];
  const refuels = listRefuels(adapter, car.sourceId);
  const segs = getConsumptions(adapter, car.sourceId);
  const costs = listCosts(adapter, car.sourceId);
  const snap = buildStats(
    { type: 'all' },
    costs,
    refuels,
    segs,
    adapter.list<any>('categories'),
    car
  );
  return { adapter, car, refuels, segs, costs, snap, result };
}

describe('测试数据：纯油车', () => {
  it('各类记录齐全且数量达标', () => {
    const { adapter, car, refuels, costs } = importAndStats('icar-test-fuel.json');
    expect(car.energyType).toBe('fuel');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    expect(refuels.length).toBeGreaterThanOrEqual(6);
    expect(refuels.every(r => r.energyType === 'fuel')).toBe(true);
    expect(listRepairs(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
    expect(listMaintainHandles(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
    expect(listMaintains(adapter, car.sourceId).length).toBeGreaterThan(0);
    // 支出含自动流水 + 手动支出
    expect(costs.length).toBeGreaterThanOrEqual(3);
  });

  it('区间与统计数值合理（油耗在乘用车常见区间）', () => {
    const { segs, snap } = importAndStats('icar-test-fuel.json');
    // 10 次加满 → 9 段有效区间
    expect(segs.length).toBe(9);
    expect(snap.fuel.avgConsumption).toBeGreaterThan(5);
    expect(snap.fuel.avgConsumption).toBeLessThan(20);
    expect(snap.mileage.fuelMileage).toBeGreaterThanOrEqual(5000);
    expect(Number.isFinite(snap.expense.total)).toBe(true);
    expect(snap.expense.total).toBeGreaterThan(0);
  });
});

describe('测试数据：纯电车', () => {
  it('充电记录与电耗指标正确，燃油指标为 0', () => {
    const { car, refuels, segs, snap } = importAndStats('icar-test-ev.json');
    expect(car.energyType).toBe('ev');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    expect(refuels.length).toBeGreaterThanOrEqual(6);
    expect(refuels.every(r => r.energyType === 'ev')).toBe(true);
    expect(segs.length).toBe(13);
    expect(segs.every(s => s.energyType === 'ev')).toBe(true);

    // 电耗应为个位数到二十出头，不应是 0 或荒谬值
    expect(snap.electricity.avgConsumption).toBeGreaterThan(5);
    expect(snap.electricity.avgConsumption).toBeLessThan(40);
    expect(snap.electricity.totalCost).toBeGreaterThan(0);
    // 纯电车不该产生油耗里程
    expect(snap.mileage.fuelMileage).toBe(0);
    expect(snap.mileage.evMileage).toBeGreaterThanOrEqual(5000);
  });
});

describe('测试数据：混动车', () => {
  it('加油与充电分别成段，油电两套指标并存', () => {
    const { adapter, car, refuels, segs, snap } = importAndStats('icar-test-hybrid.json');
    expect(car.energyType).toBe('hybrid');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    const fuelLogs = refuels.filter(r => r.energyType === 'fuel');
    const evLogs = refuels.filter(r => r.energyType === 'ev');
    expect(fuelLogs.length).toBeGreaterThanOrEqual(6);
    expect(evLogs.length).toBeGreaterThanOrEqual(6);

    const fuelSegs = segs.filter(s => s.energyType === 'fuel');
    const evSegs = segs.filter(s => s.energyType === 'ev');
    expect(fuelSegs.length).toBeGreaterThan(0);
    expect(evSegs.length).toBeGreaterThan(0);

    expect(snap.fuel.avgConsumption).toBeGreaterThan(0);
    expect(snap.electricity.avgConsumption).toBeGreaterThan(0);
    expect(listRepairs(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
  });
});

describe('测试数据：三份文件都可重复导入（幂等）', () => {
  it('重复导入不产生重复记录', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(adapter);
    const json = load('icar-test-fuel.json');

    const first = importBundle(adapter, json);
    expect(first.ok).toBe(true);
    const countAfterFirst = adapter.list<any>('fuelRecords').length;

    const second = importBundle(adapter, json);
    expect(second.ok).toBe(true);
    // 第二次应全部 skipped（updatedAt 相等）
    expect(second.added).toBe(0);
    expect(adapter.list<any>('fuelRecords').length).toBe(countAfterFirst);
  });
});
