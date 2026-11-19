// 加油与油耗计算（对齐设计报告 5.2）
import { RefuelLog, FuelConsumption, EnergyType } from '../types/models';
import { round2 } from '../utils/number';

/**
 * 单车油耗合理上限（L/100km）。
 * 极小里程区间（如 1km）会因录入误差算出数千的荒谬数值，统一收敛到该上限，
 * 避免污染统计指标并把图表点画到画布外；录入数据修正后重算即恢复真值。
 */
export const MAX_FUEL_CONSUMPTION = 30;

/**
 * 纯电车电耗合理上限（kWh/100km）。
 * 与油耗上限分开：冬季高电耗车型可达 33，套用 30 会把真实值截断。
 */
export const MAX_EV_CONSUMPTION = 50;

/** 统一收敛所有对外展示的油耗值（区间值、汇总平均、统计页平均），保证口径一致 */
export function clampFuelConsumption(value: number): number {
  if (!isFinite(value)) return 0;
  return Math.max(0, Math.min(value, MAX_FUEL_CONSUMPTION));
}

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
/** 组装一条区间实体（相邻配对与跨段累积共用） */
function makeSegment(
  start: RefuelLog,
  end: RefuelLog,
  mileage: number,
  fuelAmount: number,
  cost: number
): FuelConsumption {
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
    fuelConsumption: clampFuelConsumption((fuelAmount / mileage) * 100),
    cost,
    costPerKm: isFinite(cost) && mileage > 0 ? cost / mileage : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false
  };
}

/** 相邻两条的区间判定（BR-5.2 口径，保留供单点校验与既有测试使用） */
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
  return makeSegment(start, end, mileage, fuelAmount, cost);
}

/**
 * 重建某车的全部油耗区间（BR-25，R-04 修订口径）。
 *
 * 1. 稳定排序：fuelDate → makeMileages → sourceId，同日多次加油也有确定先后。
 * 2. 锚点 = 最近一次「加满」或「低油量补油」；此后所有加油量/金额累积，
 *    直到遇到下一条「加满」记录才结算为一段区间。这样中间的「未加满」
 *    不再打断整段，其有效里程与油耗不会丢失。
 * 3. 区间里程 = 终点里程 − 锚点里程；区间油量/金额 = 锚点之后到终点（含）之和。
 *
 * 入参为软删过滤后的现存记录；任何增删改后全量重算。
 */
export function rebuildConsumptions(logs: RefuelLog[]): FuelConsumption[] {
  const sorted = [...logs].sort(
    (a, b) =>
      a.fuelDate - b.fuelDate ||
      a.makeMileages - b.makeMileages ||
      a.sourceId.localeCompare(b.sourceId)
  );
  const result: FuelConsumption[] = [];
  let anchor: RefuelLog | null = null;
  let fuelAmount = 0;
  let cost = 0;

  for (const cur of sorted) {
    if (!anchor) {
      if (cur.isFull || cur.isLowFuel) anchor = cur;
      continue;
    }
    const mileage = cur.makeMileages - anchor.makeMileages;
    if (mileage <= 0) continue; // 里程倒退/重复记录不参与统计
    fuelAmount += cur.volume;
    cost += cur.actualPayAmount;
    if (cur.isFull) {
      result.push(makeSegment(anchor, cur, mileage, fuelAmount, cost));
      anchor = cur;
      fuelAmount = 0;
      cost = 0;
    }
  }
  return result;
}

/**
 * 按能量类型分组重建区间（R-07）。
 * 混动车同时存在加油与充电记录，必须分开成段，否则会把 L 与 kWh 混加。
 * 服务层与统计页共用，保证两处口径一致。
 */
export function rebuildConsumptionsGrouped(logs: RefuelLog[]): FuelConsumption[] {
  const groups = new Map<EnergyType, RefuelLog[]>();
  for (const l of logs) {
    const t: EnergyType = l.energyType || 'fuel';
    const arr = groups.get(t) ?? [];
    arr.push(l);
    groups.set(t, arr);
  }
  const out: FuelConsumption[] = [];
  for (const group of groups.values()) out.push(...rebuildConsumptions(group));
  return out;
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
    avgConsumption: mileage > 0 ? round2(clampFuelConsumption((fuelAmount / mileage) * 100)) : 0,
    costPerKm: mileage > 0 ? round2(cost / mileage) : 0
  };
}
