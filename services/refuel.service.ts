// 加油服务：记加油保存流程 + 记录/区间/统计读取（BR-25 / BR-26）
import { Category, Cost, FuelConsumption, RefuelLog } from '../types/models';
import { StorageAdapter } from '../repositories/storage.adapter';
import { computeShouldPay, rebuildConsumptions, summarizeConsumptions } from '../domain/fuel.service';
import { genId } from '../utils/id';
import { syncMileages } from './car.service';

export interface RefuelForm {
  carSourceId: string;
  fuelDate: number;
  makeMileages: number;
  unitPrice: number;
  volume: number;
  actualPayAmount: number | null; // null 表示取应付金额
  isFull: boolean;
  isLowFuel: boolean;
  remark?: string;
}

export function getFuelCategory(storage: StorageAdapter): Category | null {
  return (
    storage
      .list<Category>('categories')
      .find(c => !c.deleted && c.presetType === 'refuel') ?? null
  );
}

/** 记一笔加油：写 RefuelLog + Cost，全量重算区间，回写里程 */
export function saveRefuel(storage: StorageAdapter, form: RefuelForm): RefuelLog {
  const category = getFuelCategory(storage);
  if (!category) throw new Error('预设类别"加油"缺失');

  const now = Date.now();
  const shouldPay = computeShouldPay(form.unitPrice, form.volume);
  const actualPay = form.actualPayAmount === null ? shouldPay : form.actualPayAmount;

  const log: RefuelLog = {
    sourceId: genId('refuel-log'),
    sourcePlatform: 'mp',
    carSourceId: form.carSourceId,
    energyType: 'fuel',
    fuelDate: form.fuelDate,
    makeMileages: form.makeMileages,
    makeEVMileages: 0,
    makeHEVMileages: 0,
    unitPrice: form.unitPrice,
    volume: form.volume,
    shouldPayAmount: shouldPay,
    actualPayAmount: actualPay,
    isFull: form.isFull,
    isLowFuel: form.isLowFuel,
    lastRecorded: true,
    chargeBeforePercent: 0,
    chargeAfterPercent: 0,
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
  if (!log || log.deleted) throw new Error('记录不存在');

  const shouldPay = computeShouldPay(form.unitPrice, form.volume);
  const actualPay = form.actualPayAmount === null ? shouldPay : form.actualPayAmount;

  log.fuelDate = form.fuelDate;
  log.makeMileages = form.makeMileages;
  log.unitPrice = form.unitPrice;
  log.volume = form.volume;
  log.shouldPayAmount = shouldPay;
  log.actualPayAmount = actualPay;
  log.isFull = form.isFull;
  log.isLowFuel = form.isLowFuel;
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
      cost.updatedAt = Date.now();
      storage.update<Cost>('costs', cost);
    }
  }

  rebuildConsumptionsForCar(storage, form.carSourceId);
  syncMileages(storage, form.carSourceId);
  return log;
}

/** 删除加油记录：软删记录 + 关联支出，重算区间与里程 */
export function removeRefuel(storage: StorageAdapter, sourceId: string): void {
  const log = storage.get<RefuelLog>('fuelRecords', sourceId);
  if (!log || log.deleted) return;
  const carSourceId = log.carSourceId;
  storage.softDelete('fuelRecords', sourceId);
  if (log.costSourceId) storage.softDelete('costs', log.costSourceId);
  rebuildConsumptionsForCar(storage, carSourceId);
  syncMileages(storage, carSourceId);
}

/** 全量重建某车油耗区间：物理清除旧区间，写入新派生区间 */
export function rebuildConsumptionsForCar(storage: StorageAdapter, carSourceId: string): void {
  const logs = listRefuels(storage, carSourceId).sort((a, b) => a.fuelDate - b.fuelDate);
  const newSegs = rebuildConsumptions(logs);

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
