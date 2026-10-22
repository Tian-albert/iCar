// 加油与油耗计算（对齐设计报告 5.2）
import { RefuelLog, FuelConsumption } from '../types/models';
import { round2 } from '../utils/number';

/**
 * 金额联动：应付金额 = 单价 × 加油量（四舍五入 2 位）
 * 实付金额默认取应付金额（用户可改，由调用方决定）
 */
export function computeShouldPay(unitPrice: number, volume: number): number {
  return round2(unitPrice * volume);
}

/**
 * 依据区间规则计算一条油耗区间；不成立时返回 null（设计报告 5.2.2）。
 *
 * 区间成立条件：E.isFull === true 且（S.isFull === true 或 S.isLowFuel === true）。
 * 区间油耗量 / 区间金额：S.isFull ? 取 E : 取 S。
 */
export function buildConsumption(
  start: RefuelLog,
  end: RefuelLog
): FuelConsumption | null {
  const valid = end.isFull && (start.isFull || start.isLowFuel);
  if (!valid) return null;

  const mileage = end.makeMileages - start.makeMileages;
  if (mileage <= 0) return null;

  const fuelAmount = start.isFull ? end.volume : start.volume;
  const cost = start.isFull ? end.actualPayAmount : start.actualPayAmount;

  return {
    sourceId: `mp:fuel-consumption:${start.sourceId}:${end.sourceId}`,
    sourcePlatform: 'mp',
    carSourceId: end.carSourceId,
    energyType: end.energyType,
    startFuelRecordSourceId: start.sourceId,
    endFuelRecordSourceId: end.sourceId,
    startDate: start.fuelDate,
    endDate: end.fuelDate,
    fuelDate: end.fuelDate,
    mileage,
    fuelAmount,
    fuelConsumption: (fuelAmount / mileage) * 100,
    cost,
    costPerKm: cost / mileage,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };
}

/**
 * 重建某车的全部油耗区间（BR-25）。
 * 任何加油记录新增/编辑/删除后调用，入参为"软删除过滤后"的现存记录，
 * 删除中间记录后相邻关系自然重排，无需额外处理。
 */
export function rebuildConsumptions(logs: RefuelLog[]): FuelConsumption[] {
  const sorted = [...logs].sort((a, b) => a.fuelDate - b.fuelDate);
  const result: FuelConsumption[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const c = buildConsumption(sorted[i], sorted[i + 1]);
    if (c) result.push(c);
  }
  return result;
}

/**
 * 汇总若干区间的统计（供详情页"平均油耗 / 元每公里"使用）。
 * 注意与统计页口径区分：此处元/km 取 2 位（0.63），统计页取 3 位（1.317）。
 */
export function summarizeConsumptions(list: FuelConsumption[]) {
  const mileage = list.reduce((s, c) => s + c.mileage, 0);
  const fuelAmount = list.reduce((s, c) => s + c.fuelAmount, 0);
  const cost = list.reduce((s, c) => s + c.cost, 0);
  return {
    mileage,
    fuelAmount,
    cost,
    avgConsumption: mileage > 0 ? round2((fuelAmount / mileage) * 100) : 0,
    costPerKm: mileage > 0 ? round2(cost / mileage) : 0
  };
}
