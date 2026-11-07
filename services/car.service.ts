// 车辆服务：档案 CRUD + 里程回写（BR-12）
import { Car, EnergyType } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { RefuelLog, MaintainHandle, RepairRecord } from '../types/models';
import { genId } from '../utils/id';

export interface CarForm {
  name: string;
  mileages: number;
  initMileages?: number;
  initDate: number;
  energyType: EnergyType;
  icon?: string;
  /** 电池容量 kWh（纯电 / 混动，R-07） */
  batteryCapacity?: number;
}

/**
 * 可编辑的车辆字段（当前里程由记录回写，不在编辑范围）。
 * 复用 CarForm 的字段定义，避免两处同义字段各自声明。
 */
export type CarEditForm = Required<Pick<CarForm, 'name' | 'initDate' | 'icon' | 'energyType'>> & {
  /** 编辑态必填（CarForm 中为可选） */
  initMileages: number;
  batteryCapacity: number;
};

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
    batteryCapacity: form.batteryCapacity ?? 0,
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

/** 编辑车辆档案：只改名称 / 初始里程 / 购车日期 / 图标，不动能量类型 */
export function updateCar(
  storage: StorageAdapter,
  sourceId: string,
  form: CarEditForm
): Car | null {
  const car = getCar(storage, sourceId);
  if (!car) return null;
  car.name = form.name.trim();
  car.initMileages = form.initMileages;
  car.initDate = form.initDate;
  car.icon = form.icon;
  car.energyType = form.energyType;
  car.batteryCapacity = form.batteryCapacity;
  car.updatedAt = Date.now();
  storage.update('cars', car);
  // 当前里程由加油记录回写（syncMileages），编辑车辆不触碰，遵守 Q8 的四字段范围
  return car;
}

/**
 * 车辆总里程 = 现存记录中的最大里程（加油 / 保养执行 / 维修，均过滤软删）。
 * R-01：保养与维修同样携带里程，纳入回写，避免只按加油记录推进。
 */
export function syncMileages(
  storage: StorageAdapter,
  carSourceId: string,
  allowDecrease = false
): void {
  const car = getCar(storage, carSourceId);
  if (!car) return;

  const fuel = storage
    .list<RefuelLog>('fuelRecords')
    .filter(r => r.carSourceId === carSourceId && !r.deleted)
    .map(r => r.makeMileages);
  const handles = storage
    .list<MaintainHandle>('maintainHandles')
    .filter(r => r.carSourceId === carSourceId && !r.deleted)
    .map(r => r.makeMileages);
  const repairs = storage
    .list<RepairRecord>('repairRecords')
    .filter(r => r.carSourceId === carSourceId && !r.deleted)
    .map(r => r.mileage);

  const all = [...fuel, ...handles, ...repairs].filter(n => isFinite(n) && n >= 0);
  const derived = all.length ? Math.max(...all) : car.initMileages;
  // 补录历史里程（小于当前里程）不应让车辆里程倒退；仅删除记录时允许回退
  const next = allowDecrease ? derived : Math.max(car.mileages, derived);
  if (car.mileages !== next) {
    car.mileages = next;
    car.updatedAt = Date.now();
    storage.update('cars', car);
  }
}
