// 车辆服务：档案 CRUD + 里程回写（BR-12）
import { Car, EnergyType } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { RefuelLog } from '../types/models';
import { genId } from '../utils/id';

export interface CarForm {
  name: string;
  mileages: number;
  initMileages?: number;
  initDate: number;
  energyType: EnergyType;
  icon?: string;
}

export function createCar(storage: StorageAdapter, form: CarForm): Car {
  const now = Date.now();
  const car: Car = {
    sourceId: genId('cars'),
    sourcePlatform: 'mp',
    name: form.name.trim(),
    type: 'car',
    icon: form.icon ?? 'car',
    customIconAssetId: '',
    initDate: form.initDate,
    initMileages: form.initMileages ?? form.mileages,
    mileages: form.mileages,
    evMileages: 0,
    hevMileages: 0,
    batteryCapacity: 0,
    energyType: form.energyType,
    energyTrackingEnabled: true,
    maintainSoonMileage: 500,
    maintainSoonDays: 15,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  return storage.insert<Car>('cars', car);
}

export function listCars(storage: StorageAdapter): Car[] {
  return storage.list<Car>('cars').filter(c => !c.deleted);
}

export function getCar(storage: StorageAdapter, sourceId: string): Car | null {
  const car = storage.get<Car>('cars', sourceId);
  return car && !car.deleted ? car : null;
}

/** 更换车辆图标 */
export function setCarIcon(storage: StorageAdapter, sourceId: string, icon: string): void {
  const car = getCar(storage, sourceId);
  if (!car) return;
  car.icon = icon;
  car.updatedAt = Date.now();
  storage.update('cars', car);
}

/** 车辆总里程 = 现存加油记录的最大里程（软删过滤后） */
export function syncMileages(storage: StorageAdapter, carSourceId: string): void {
  const car = getCar(storage, carSourceId);
  if (!car) return;
  const records = storage
    .list<RefuelLog>('fuelRecords')
    .filter(r => r.carSourceId === carSourceId && !r.deleted);
  const max = records.length ? Math.max(...records.map(r => r.makeMileages)) : car.initMileages;
  if (car.mileages !== max) {
    car.mileages = max;
    car.updatedAt = Date.now();
    storage.update('cars', car);
  }
}
