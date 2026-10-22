// iCar 数据模型类型定义（对齐设计报告 4.2 / 7.1）
// 所有实体使用跨端稳定主键 sourceId，通用字段 createdAt/updatedAt/deleted。

export type SourcePlatform = 'mp' | 'app' | 'web';
export type EnergyType = 'fuel' | 'ev' | 'hybrid';
export type MileageSource = 'total' | 'ev' | 'hev';
export type CycleUnit = 'km' | 'day' | 'month' | 'year' | '';
export type PresetType = 'maintain' | 'fix' | 'ev' | 'refuel' | '';
export type MemberLevel = 'free' | 'pro';

export interface BaseEntity {
  sourceId: string;
  sourcePlatform: SourcePlatform;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface Car extends BaseEntity {
  name: string;
  type: 'car' | 'motorcycle' | 'other';
  icon: string;
  customIconAssetId: string;
  initDate: number;
  /** 购车/建档时里程 (km)，保养剩余量"无保养记录"时的里程基线 */
  initMileages: number;
  /** 当前总里程 (km) */
  mileages: number;
  evMileages: number;
  hevMileages: number;
  batteryCapacity: number;
  energyType: EnergyType;
  energyTrackingEnabled: boolean;
  /** 保养提醒阈值：剩余里程 ≤ 该值 (km) 视为"快要保养" */
  maintainSoonMileage: number;
  /** 保养提醒阈值：剩余天数 ≤ 该值 (天) 视为"快要保养" */
  maintainSoonDays: number;
}

export interface Category extends BaseEntity {
  name: string;
  icon: string;
  isPreset: boolean;
  presetType: PresetType;
  /** 是否在"记支出"类别选择中显示（用户可在类别管理里开关） */
  visible: boolean;
}

export interface Maintain extends BaseEntity {
  carSourceId: string;
  name: string;
  icon: string;
  cycleMileages: number;
  cycleDays: number;
  cycleMonths: number;
  cycleUnit: CycleUnit;
  cycleValue: number;
  mileageSource: MileageSource;
  sortOrder: number;
}

export interface MaintainHandle extends BaseEntity {
  carSourceId: string;
  makeDate: number;
  makeMileages: number;
  makeEVMileages: number;
  makeHEVMileages: number;
  remark: string;
  costSourceId: string;
}

export interface MaintainLog extends BaseEntity {
  carSourceId: string;
  maintainSourceId: string;
  handleSourceId: string;
  makeDate: number;
  makeMileages: number;
  totalMileages: number;
  makeEVMileages: number;
  makeHEVMileages: number;
  mileageSource: MileageSource;
  remark: string;
}

export interface Cost extends BaseEntity {
  carSourceId: string;
  categorySourceId: string;
  amount: number;
  costDate: number;
  remark: string;
  maintainHandleSourceId: string;
  repairSourceId: string;
  fuelRecordSourceId: string;
}

export interface RefuelLog extends BaseEntity {
  carSourceId: string;
  energyType: EnergyType;
  fuelDate: number;
  makeMileages: number;
  makeEVMileages: number;
  makeHEVMileages: number;
  unitPrice: number;
  volume: number;
  shouldPayAmount: number;
  actualPayAmount: number;
  isFull: boolean;
  isLowFuel: boolean;
  lastRecorded: boolean;
  chargeBeforePercent: number;
  chargeAfterPercent: number;
  remark: string;
  costSourceId: string;
}

export interface RepairRecord extends BaseEntity {
  carSourceId: string;
  content: string;
  mileage: number;
  repairDate: number;
  amount: number;
  images: string[];
  remark: string;
  costSourceId: string;
}

export interface FuelConsumption extends BaseEntity {
  carSourceId: string;
  energyType: EnergyType;
  startFuelRecordSourceId: string;
  endFuelRecordSourceId: string;
  startDate: number;
  endDate: number;
  fuelDate: number;
  mileage: number;
  fuelAmount: number;
  fuelConsumption: number;
  cost: number;
  costPerKm: number;
}

export interface User extends BaseEntity {
  openid: string;
  nickname: string;
  avatarUrl: string;
  remindEnabled: boolean;
  reminderSentCount: number;
  memberLevel: MemberLevel;
  memberExpireAt: number;
  appLockEnabled: boolean;
  appLockPin: string;
  lastPulledAt: number;
  /** 置顶车辆 sourceId（'' 表示未置顶） */
  pinnedCarId: string;
}

/** 导出数据全集（对应 manifest.json 的 data 字段） */
export interface DataBundle {
  cars: Car[];
  categories: Category[];
  maintains: Maintain[];
  maintainHandles: MaintainHandle[];
  maintainLogs: MaintainLog[];
  costs: Cost[];
  repairRecords: RepairRecord[];
  fuelRecords: RefuelLog[];
  fuelConsumptions: FuelConsumption[];
  user?: User;
}
