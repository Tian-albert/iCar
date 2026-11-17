// 加油服务：记加油保存流程 + 记录/区间/统计读取（BR-25 / BR-26）
import { Category, Cost, EnergyType, FuelConsumption, RefuelLog } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import {
  computeShouldPay,
  rebuildConsumptionsGrouped,
  summarizeConsumptions
} from '../domain/fuel.service';
import { genId } from '../utils/id';
import { round2, isValidAmount } from '../utils/number';
import { syncMileages } from './car.service';
import { serviceError } from './service-error';

export interface RefuelForm {
  carSourceId: string;
  fuelDate: number;
  makeMileages: number;
  unitPrice: number;
  volume: number;
  actualPayAmount: number | null; // null 表示取应付金额
  isFull: boolean;
  isLowFuel: boolean;
  /** 上次加油是否已记录（仅作记录信息，不参与油耗区间判定） */
  lastRecorded?: boolean;
  remark?: string;
  /** R-07：能量类型，缺省 fuel 保持既有调用兼容 */
  energyType?: EnergyType;
  /** 充电前 / 后电量百分比（纯电记录） */
  chargeBeforePercent?: number;
  chargeAfterPercent?: number;
  /** 混动里程拆分（km） */
  makeEVMileages?: number;
  makeHEVMileages?: number;
}

/**
 * 实付金额兜底：null/undefined 取应付金额；
 * 负数、NaN、Infinity、非数值一律回退应付金额，绝不把 0 或负数写进账本。
 */
function resolveActualPay(raw: number | null | undefined, shouldPay: number): number {
  if (raw === null || raw === undefined) return shouldPay;
  if (typeof raw !== 'number' || !isValidAmount(raw)) return shouldPay;
  return round2(raw);
}

/** 取「加油」预设类别；预设被删时返回 `null`（查询类不抛错） */
export function getFuelCategory(storage: StorageAdapter): Category | null {
  return getEnergyCategory(storage, 'fuel');
}

/**
 * R-07：按能量类型取关联支出类别（充电 / 加油）。
 *
 * 充电记录用「充电」预设（presetType=ev），老库没有该预设时回退「加油」类别，
 * 保证历史备份导入后仍可正常落库。
 *
 * 查不到返回 `null`。**注意**：写入类调用方（`saveRefuel`）拿到 `null` 后
 * 必须自己抛 `ServiceError`，因为「缺类别」会让这笔记录无法归类。
 */
export function getEnergyCategory(storage: StorageAdapter, energyType: EnergyType): Category | null {
  const all = storage.list<Category>('categories').filter(c => !c.deleted);
  const wanted = energyType === 'ev' ? 'ev' : 'refuel';
  return (
    all.find(c => c.presetType === wanted) ??
    (wanted === 'ev' ? all.find(c => c.presetType === 'refuel') ?? null : null)
  );
}

/** 记一笔加油 / 充电：写 RefuelLog + Cost，全量重算区间，回写里程 */
export function saveRefuel(storage: StorageAdapter, form: RefuelForm): RefuelLog {
  const energyType: EnergyType = form.energyType ?? 'fuel';
  const category = getEnergyCategory(storage, energyType);
  // 预设类别被删后无法自动归类。用户能做的只有去类别管理恢复，所以文案给出动作。
  if (!category) throw serviceError('缺少「加油」类别，请到类别管理恢复');

  const now = Date.now();
  const shouldPay = computeShouldPay(form.unitPrice, form.volume);
  const actualPay = resolveActualPay(form.actualPayAmount, shouldPay);

  const log: RefuelLog = {
    sourceId: genId('refuel-log'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    energyType,
    fuelDate: form.fuelDate,
    makeMileages: form.makeMileages,
    makeEVMileages: form.makeEVMileages ?? 0,
    makeHEVMileages: form.makeHEVMileages ?? 0,
    unitPrice: form.unitPrice,
    volume: form.volume,
    shouldPayAmount: shouldPay,
    actualPayAmount: actualPay,
    isFull: form.isFull,
    isLowFuel: form.isLowFuel,
    lastRecorded: form.lastRecorded ?? true,
    chargeBeforePercent: form.chargeBeforePercent ?? 0,
    chargeAfterPercent: form.chargeAfterPercent ?? 0,
    remark: form.remark ?? '',
    costSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  storage.insert<RefuelLog>('fuelRecords', log);

  // 关联支出流水（BR-15 / BR-26）
  const cost: Cost = {
    sourceId: genId('costs'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    categorySourceId: category.sourceId,
    amount: actualPay,
    costDate: form.fuelDate,
    remark: form.remark ?? '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: log.sourceId,
    createdAt: now,
    updatedAt: now,
    deleted: false
  };
  storage.insert<Cost>('costs', cost);

  // 回写 costSourceId
  log.costSourceId = cost.sourceId;
  storage.update<RefuelLog>('fuelRecords', log);

  // 全量重算油耗区间（BR-25）
  rebuildConsumptionsForCar(storage, form.carSourceId);

  // 回写车辆总里程（BR-12）
  syncMileages(storage, form.carSourceId);

  return log;
}

/** 编辑加油记录（BR-25/26：联动 Cost、全量重算区间、回写里程） */
export function updateRefuel(storage: StorageAdapter, sourceId: string, form: RefuelForm): RefuelLog {
  const log = storage.get<RefuelLog>('fuelRecords', sourceId);
  if (!log || log.deleted) throw serviceError('这条记录已被删除');

  const shouldPay = computeShouldPay(form.unitPrice, form.volume);
  const actualPay = resolveActualPay(form.actualPayAmount, shouldPay);

  log.fuelDate = form.fuelDate;
  log.makeMileages = form.makeMileages;
  log.unitPrice = form.unitPrice;
  log.volume = form.volume;
  log.shouldPayAmount = shouldPay;
  log.actualPayAmount = actualPay;
  log.isFull = form.isFull;
  log.isLowFuel = form.isLowFuel;
  log.lastRecorded = form.lastRecorded ?? log.lastRecorded;
  log.energyType = form.energyType ?? log.energyType ?? 'fuel';
  log.chargeBeforePercent = form.chargeBeforePercent ?? log.chargeBeforePercent ?? 0;
  log.chargeAfterPercent = form.chargeAfterPercent ?? log.chargeAfterPercent ?? 0;
  log.makeEVMileages = form.makeEVMileages ?? log.makeEVMileages ?? 0;
  log.makeHEVMileages = form.makeHEVMileages ?? log.makeHEVMileages ?? 0;
  log.remark = form.remark ?? '';
  log.updatedAt = Date.now();
  storage.update<RefuelLog>('fuelRecords', log);

  // 联动关联支出流水（BR-26）
  if (log.costSourceId) {
    const cost = storage.get<Cost>('costs', log.costSourceId);
    if (cost && !cost.deleted) {
      cost.amount = actualPay;
      cost.costDate = form.fuelDate;
      cost.remark = form.remark ?? '';
      // 能量类型可能被改（加油 ↔ 充电），关联支出的类别必须跟着换，
      // 否则分类统计与环图会长期把这笔钱算在旧类别里（静默错账）。
      const energyCategory = getEnergyCategory(storage, log.energyType);
      if (energyCategory) cost.categorySourceId = energyCategory.sourceId;
      cost.updatedAt = Date.now();
      storage.update<Cost>('costs', cost);
    }
  }

  // 用记录自身的车算一遍；若表单把车改了，两辆都要重算，
  // 否则原车会留着一条已不属于它的区间、新车又少了这段
  const affected = new Set<string>();
  if (log.carSourceId) affected.add(log.carSourceId);
  if (form.carSourceId) affected.add(form.carSourceId);
  affected.forEach(carId => {
    rebuildConsumptionsForCar(storage, carId);
    syncMileages(storage, carId);
  });
  return log;
}

/**
 * 删除加油/充电记录（软删，连带关联支出，进回收站）。
 *
 * **幂等**：记录不存在或已删也照常返回，不抛错。
 */
export function removeRefuel(storage: StorageAdapter, sourceId: string): void {
  const log = storage.get<RefuelLog>('fuelRecords', sourceId);
  if (!log || log.deleted) return;
  const carSourceId = log.carSourceId;
  // 记录与关联支出共用删除批次，回收站可一次撤销
  const batch = genId('del');
  storage.softDelete('fuelRecords', sourceId, batch);
  if (log.costSourceId) storage.softDelete('costs', log.costSourceId, batch);
  rebuildConsumptionsForCar(storage, carSourceId);
  syncMileages(storage, carSourceId, true);
}

/** 全量重建某车能耗区间：物理清除旧区间，写入新派生区间 */
export function rebuildConsumptionsForCar(storage: StorageAdapter, carSourceId: string): void {
  const logs = listRefuels(storage, carSourceId).sort((a, b) => a.fuelDate - b.fuelDate);
  const newSegs = rebuildConsumptionsGrouped(logs);

  const old = storage
    .list<FuelConsumption>('fuelConsumptions')
    .filter(c => c.carSourceId === carSourceId);
  for (const o of old) storage.hardDelete('fuelConsumptions', o.sourceId);
  for (const s of newSegs) storage.insert<FuelConsumption>('fuelConsumptions', s);
}

export function listRefuels(storage: StorageAdapter, carSourceId: string): RefuelLog[] {
  return storage
    .list<RefuelLog>('fuelRecords')
    .filter(r => r.carSourceId === carSourceId && !r.deleted)
    .sort((a, b) => b.fuelDate - a.fuelDate); // 倒序（最新在前）
}

export function getConsumptions(storage: StorageAdapter, carSourceId: string): FuelConsumption[] {
  return storage
    .list<FuelConsumption>('fuelConsumptions')
    .filter(c => c.carSourceId === carSourceId && !c.deleted)
    .sort((a, b) => b.fuelDate - a.fuelDate);
}

/** 详情页油耗摘要（平均油耗 / 元每公里，2 位小数口径） */
export function getFuelSummary(storage: StorageAdapter, carSourceId: string) {
  return summarizeConsumptions(getConsumptions(storage, carSourceId));
}

/** 最近一次有效区间（用于详情页「最近油耗」卡） */
export function getLatestConsumption(
  storage: StorageAdapter,
  carSourceId: string,
  energyType?: EnergyType
): FuelConsumption | null {
  const list = getConsumptions(storage, carSourceId).filter(
    c => !energyType || (c.energyType || 'fuel') === energyType
  );
  if (!list.length) return null;
  return [...list].sort((a, b) => b.endDate - a.endDate)[0];
}
