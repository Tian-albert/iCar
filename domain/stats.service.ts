// 统计聚合（对齐设计报告 5.10 / 7.6）
import { Car, Category, Cost, FuelConsumption, RefuelLog } from '../types/models';
import { round2, round3 } from '../utils/number';
import { monthLabel, startOfDay } from '../utils/date';

export type StatsRange =
  | { type: 'month'; year: number; month: number }
  | { type: 'year'; year: number }
  | { type: 'all' };

export interface StatsSnapshot {
  mileage: { latest: number; increased: number; fuelMileage: number };
  fuel: { totalCost: number; avgConsumption: number; costPerKm: number };
  expense: { total: number; perKm: number; perKmExFuel: number };
  categories: Array<{
    categorySourceId: string;
    name: string;
    amount: number;
    percent: number;
    color: string;
  }>;
  consumptionTrend: Array<{ date: number; value: number; mileage: number }>;
  monthlyMileage: Array<{ label: string; value: number }>;
  monthlyCost: Array<{ label: string; value: number }>;
}

/** 分类支出环形图配色（设计报告 6.1） */
export const CHART_COLORS = [
  '#3B82F6',
  '#22C55E',
  '#F59E0B',
  '#EF4444',
  '#A855F7',
  '#14B8A6'
];

function endOfDay(d: Date): number {
  const t = new Date(d);
  t.setHours(23, 59, 59, 999);
  return t.getTime();
}

/** 解析维度为 [start, end] 时间区间（本地时区） */
export function resolveRange(range: StatsRange): { start: number; end: number } {
  if (range.type === 'all') {
    return { start: 0, end: Number.MAX_SAFE_INTEGER };
  }
  if (range.type === 'year') {
    const start = new Date(range.year, 0, 1).getTime();
    const end = endOfDay(new Date(range.year, 11, 31));
    return { start, end };
  }
  const start = new Date(range.year, range.month - 1, 1).getTime();
  const end = endOfDay(new Date(range.year, range.month, 0));
  return { start, end };
}

/** 按本地月份聚合 value 序列（BR-23：无数据月份不补零） */
function groupByMonth<T>(
  list: T[],
  dateOf: (x: T) => number,
  valueOf: (x: T) => number
): Array<{ label: string; value: number }> {
  const map = new Map<string, number>();
  for (const x of list) {
    const label = monthLabel(dateOf(x));
    map.set(label, (map.get(label) ?? 0) + valueOf(x));
  }
  // 按时间升序（以 label 出现顺序不保证有序，这里按首次出现顺序即可满足月度序列）
  return [...map.entries()].map(([label, value]) => ({ label, value: round2(value) }));
}

/**
 * 一次筛选、一次遍历产出全部指标（设计报告 7.6）。
 * 入参为软删除过滤后的现存数据。
 */
export function buildStats(
  range: StatsRange,
  costs: Cost[],
  refuels: RefuelLog[],
  consumptions: FuelConsumption[],
  categories: Category[],
  car: Car
): StatsSnapshot {
  const { start, end } = resolveRange(range);
  const inRange = (t: number) => t >= start && t <= end;

  const costList = costs.filter(c => inRange(c.costDate));
  const fuelList = refuels
    .filter(r => inRange(r.fuelDate))
    .sort((a, b) => a.fuelDate - b.fuelDate);
  const segList = consumptions
    .filter(c => inRange(c.endDate))
    .sort((a, b) => a.endDate - b.endDate);

  // ---------- 里程 ----------
  const latest = fuelList.length ? Math.max(...fuelList.map(r => r.makeMileages)) : car.mileages;
  const mileages = fuelList.map(r => r.makeMileages);
  const increased = mileages.length > 1 ? Math.max(...mileages) - Math.min(...mileages) : 0;
  const fuelMileage = segList.reduce((s, c) => s + c.mileage, 0);

  // ---------- 油耗 / 支出 ----------
  const totalFuelCost = round2(fuelList.reduce((s, r) => s + r.actualPayAmount, 0));
  const sumFuelAmount = segList.reduce((s, c) => s + c.fuelAmount, 0);
  const totalCost = round2(costList.reduce((s, c) => s + c.amount, 0));

  const avgConsumption = fuelMileage > 0 ? (sumFuelAmount / fuelMileage) * 100 : 0;
  const fuelCostPerKm = fuelMileage > 0 ? totalFuelCost / fuelMileage : 0;
  const expensePerKm = increased > 0 ? totalCost / increased : 0;
  const expensePerKmExFuel = increased > 0 ? (totalCost - totalFuelCost) / increased : 0;

  // ---------- 分类支出（降序 + 最大余数补齐 100%） ----------
  const byCategory = new Map<string, number>();
  for (const c of costList) {
    byCategory.set(c.categorySourceId, (byCategory.get(c.categorySourceId) ?? 0) + c.amount);
  }
  const named = [...byCategory.entries()]
    .map(([id, amount]) => ({
      categorySourceId: id,
      name: categories.find(x => x.sourceId === id)?.name ?? '其他',
      amount: round2(amount),
      percent: totalCost > 0 ? round2((amount / totalCost) * 100) : 0,
      color: ''
    }))
    .sort((a, b) => b.amount - a.amount);

  if (named.length && totalCost > 0) {
    const diff = round2(100 - named.reduce((s, x) => s + x.percent, 0));
    named[0].percent = round2(named[0].percent + diff);
  }
  const categoriesOut = named.map((x, i) => ({ ...x, color: CHART_COLORS[i % CHART_COLORS.length] }));

  // ---------- 月度聚合（BR-23） ----------
  const monthlyMileage = groupByMonth(segList, c => c.endDate, c => c.mileage);
  const monthlyCost = groupByMonth(costList, c => c.costDate, c => c.amount);

  return {
    mileage: { latest, increased, fuelMileage },
    fuel: { totalCost: totalFuelCost, avgConsumption: round2(avgConsumption), costPerKm: round3(fuelCostPerKm) },
    expense: { total: totalCost, perKm: round3(expensePerKm), perKmExFuel: round3(expensePerKmExFuel) },
    categories: categoriesOut,
    consumptionTrend: segList.map(c => ({ date: c.endDate, value: round2(c.fuelConsumption), mileage: c.mileage })),
    monthlyMileage,
    monthlyCost
  };
}
