// R-07 / V2-08：纯电充电录入、混动分组区间、电耗统计、燃油零回归
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveRefuel, listRefuels, getConsumptions } from '../services/refuel.service';
import { listCosts, listCategories } from '../services/cost.service';
import { buildStats } from '../domain/stats.service';
import { EnergyType } from '../types/models';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function setup(energyType: EnergyType = 'ev') {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: '测试车',
    mileages: 0,
    initDate: Date.now(),
    energyType,
    batteryCapacity: 60
  });
  return { adapter, car };
}

function record(
  adapter: StorageAdapter,
  carId: string,
  km: number,
  amount: number,
  energyType: 'fuel' | 'ev',
  unitPrice = 1.2
) {
  return saveRefuel(adapter, {
    carSourceId: carId,
    fuelDate: new Date(2026, 4, 1).getTime() + km * 1000,
    makeMileages: km,
    unitPrice,
    volume: amount,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType,
    chargeBeforePercent: energyType === 'ev' ? 20 : 0,
    chargeAfterPercent: energyType === 'ev' ? 90 : 0
  });
}

function snapshot(adapter: StorageAdapter, carId: string, energyType: EnergyType) {
  const car = adapter.get<any>('cars', carId)!;
  const costs = listCosts(adapter, carId);
  const refuels = listRefuels(adapter, carId);
  const segs = getConsumptions(adapter, carId);
  return { segs, snap: buildStats({ type: 'all' }, costs, refuels, segs, listCategories(adapter), { ...car, energyType }) };
}

describe('R-07 纯电充电录入', () => {
  it('充电百分比与能量类型落库，关联支出归到「充电」类别', () => {
    const { adapter, car } = setup('ev');
    const log = record(adapter, car.sourceId, 100, 50, 'ev');

    expect(log.energyType).toBe('ev');
    expect(log.chargeBeforePercent).toBe(20);
    expect(log.chargeAfterPercent).toBe(90);
    expect(log.volume).toBe(50); // kWh

    const cost = adapter.get<any>('costs', log.costSourceId)!;
    const category = adapter.get<any>('categories', cost.categorySourceId)!;
    expect(category.name).toBe('充电');
    expect(cost.amount).toBe(60); // 50 kWh × 1.2 元/kWh
  });
});

describe('R-07 混动按能量类型分组', () => {
  it('加油与充电分别成区间，L 与 kWh 不混加', () => {
    const { adapter, car } = setup('hybrid');
    record(adapter, car.sourceId, 100, 40, 'fuel');
    record(adapter, car.sourceId, 500, 40, 'fuel');
    record(adapter, car.sourceId, 600, 30, 'ev');
    record(adapter, car.sourceId, 900, 30, 'ev');

    const segs = getConsumptions(adapter, car.sourceId);
    expect(segs.length).toBe(2);

    const fuelSeg = segs.find(s => s.energyType === 'fuel')!;
    const evSeg = segs.find(s => s.energyType === 'ev')!;
    expect(fuelSeg.mileage).toBe(400);
    expect(fuelSeg.fuelAmount).toBe(40);
    expect(evSeg.mileage).toBe(300);
    expect(evSeg.fuelAmount).toBe(30);
    expect(evSeg.fuelConsumption).toBeCloseTo(10, 2);
  });
});

describe('R-07 电耗统计', () => {
  it('纯电车给出 kWh/100km、总电费与每公里电费', () => {
    const { adapter, car } = setup('ev');
    record(adapter, car.sourceId, 100, 25, 'ev');
    record(adapter, car.sourceId, 600, 25, 'ev');

    const { segs, snap } = snapshot(adapter, car.sourceId, 'ev');
    expect(segs.length).toBe(1);
    expect(snap.electricity.mileage).toBe(500);
    expect(snap.electricity.energy).toBe(25);
    expect(snap.electricity.avgConsumption).toBe(5);
    expect(snap.electricity.totalCost).toBe(60);
    expect(snap.electricity.costPerKm).toBeCloseTo(0.12, 3);
    // 纯电车不应产生油耗；趋势按电耗主口径
    expect(snap.fuel.avgConsumption).toBe(0);
    expect(snap.consumptionTrend.length).toBe(1);
  });

  it('燃油车统计零回归：电耗指标全为 0', () => {
    const { adapter, car } = setup('fuel');
    record(adapter, car.sourceId, 100, 40, 'fuel');
    record(adapter, car.sourceId, 600, 40, 'fuel');

    const { snap } = snapshot(adapter, car.sourceId, 'fuel');
    expect(snap.electricity.avgConsumption).toBe(0);
    expect(snap.electricity.mileage).toBe(0);
    expect(snap.electricity.totalCost).toBe(0);
    expect(snap.fuel.avgConsumption).toBe(8); // 40L / 500km
    expect(snap.consumptionTrend.length).toBe(1);
  });
});
