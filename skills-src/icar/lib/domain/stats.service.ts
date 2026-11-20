// 统计聚合（对齐设计报告 5.10 / 7.6）
import { Car, Category, Cost, FuelConsumption, RefuelLog } from '../types/models';
import { maxOf, minOf, round2, round3 } from '../utils/number';
import { monthLabel, monthLabelWithYear, startOfDay } from '../utils/date';
import { clampFuelConsumption, MAX_EV_CONSUMPTION } from './fuel.service';

export type StatsRange =
  | { type: 'month'; year: number; month: number }
  | { type: 'year'; year: number }
  | { type: 'all' };

export interface StatsSnapshot {
  mileage: { latest: number; increased: number; fuelMileage: number; evMileage: number };
  fuel: { totalCost: number; avgConsumption: number; costPerKm: number };
  /** R-07：电耗指标（kWh/100km），纯电 / 混动车有效 */
  electricity: {
    totalCost: number;
    energy: number;
    mileage: number;
    avgConsumption: number;
    costPerKm: number;
  };
  expense: { total: number; perKm: number; perKmExFuel: number };
  categories: Array<{
    categorySourceId: string;
    name: string;
    amount: number;
    percent: number;
    color: string;
  }>;
  consumptionTrend: Array<{ date: number; value: number; mileage: number }>;
  /** @deprecated 用 mileageTrend：它按区间自动选粒度 */
  monthlyMileage: Array<{ label: string; value: number }>;
  /** @deprecated 用 costTrend：它按区间自动选粒度 */
  monthlyCost: Array<{ label: string; value: number }>;
  /** 当前区间的图表粒度（年→月、月→日、全部→年） */
  trendGranularity: TrendGranularity;
  /** 行程趋势（按 trendGranularity 聚合） */
  mileageTrend: TrendPoint[];
  /** 费用趋势（按 trendGranularity 聚合） */
  costTrend: TrendPoint[];
}

/** 图表粒度：跟着页面区间走 */
export type TrendGranularity = 'day' | 'month' | 'year';

export interface TrendPoint {
  label: string;
  value: number;
}

/** 粒度的中文名（页面角标与图表标题共用，避免各页各写一套） */
export const TREND_GRANULARITY_LABEL: Record<TrendGranularity, string> = {
  day: '日',
  month: '月',
  year: '年'
};

/**
 * 区间 → 图表粒度。
 *
 * 看一年时按月看才有趋势；看一个月时必须按日，否则整月只有一个柱子；
 * 看全部时必须按年，否则不同年份的同月会被合并成一个点。
 */
export function trendGranularityOf(range: StatsRange): TrendGranularity {
  if (range.type === 'month') return 'day';
  if (range.type === 'year') return 'month';
  return 'year';
}

/**
 * 分类支出 / 按车花费的配色（设计报告 6.1）。
 *
 * 10 色：超过 6 辆车时不再出现「第 7 辆与第 1 辆同色」。
 * 色相分布刻意拉开（蓝/绿/橙/红/紫/青/粉/靛/棕/黄绿），
 * 保证相邻两项在白底上也能区分。
 *
 * 与 app.wxss 的 --chart-1..--chart-10 必须一一对应（tests/chart-colors.test.ts 有断言）。
 */
export const CHART_COLORS = [
  '#3B82F6', // 1 蓝
  '#22C55E', // 2 绿
  '#F59E0B', // 3 橙
  '#EF4444', // 4 红
  '#A855F7', // 5 紫
  '#14B8A6', // 6 青
  '#EC4899', // 7 粉
  '#6366F1', // 8 靛
  '#78716C', // 9 棕灰
  '#84CC16' // 10 黄绿
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

/**
 * 按本地月份聚合 value 序列（BR-23：无数据月份不补零）。
 * 跨度跨年时标签带年份，否则「全部」范围会把 2025/7 与 2026/7 合并成一个点。
 */
function groupByMonth<T>(
  list: T[],
  dateOf: (x: T) => number,
  valueOf: (x: T) => number
): Array<{ label: string; value: number }> {
  const years = new Set(list.map(x => new Date(dateOf(x)).getFullYear()));
  const crossYear = years.size > 1;
  // 记下每个月份标签对应的最早时间戳，最后按它排序。
  // 不能依赖「首次出现顺序」——入参可能是降序（listCosts 就是按 costDate 降序），
  // 那样柱状图会变成最新→最旧，与「月度行程」的升序方向相反。
  const map = new Map<string, { value: number; firstTs: number }>();
  for (const x of list) {
    const ts = dateOf(x);
    const label = crossYear ? monthLabelWithYear(ts) : monthLabel(ts);
    const hit = map.get(label);
    if (hit) {
      hit.value += valueOf(x);
      if (ts < hit.firstTs) hit.firstTs = ts;
    } else {
      map.set(label, { value: valueOf(x), firstTs: ts });
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].firstTs - b[1].firstTs)
    .map(([label, agg]) => ({ label, value: round2(agg.value) }));
}

/**
 * 按粒度聚合 value 序列（day / month / year）。
 *
 * day 的标签是「日」数字（3），month 复用 groupByMonth（跨年时带年份），
 * year 的标签是四位年份。无数据的桶不补零（BR-23）。
 */
export function groupByGranularity<T>(
  list: T[],
  dateOf: (x: T) => number,
  valueOf: (x: T) => number,
  granularity: TrendGranularity
): TrendPoint[] {
  if (granularity === 'month') return groupByMonth(list, dateOf, valueOf);

  const map = new Map<string, { value: number; firstTs: number }>();
  for (const x of list) {
    const ts = dateOf(x);
    const d = new Date(ts);
    const label = granularity === 'day' ? String(d.getDate()) : String(d.getFullYear());
    const hit = map.get(label);
    if (hit) {
      hit.value += valueOf(x);
      if (ts < hit.firstTs) hit.firstTs = ts;
    } else {
      map.set(label, { value: valueOf(x), firstTs: ts });
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[1].firstTs - b[1].firstTs)
    .map(([label, agg]) => ({ label, value: round2(agg.value) }));
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
  // 用 maxOf/minOf 而不是 Math.max(...)：记录上万条时展开成实参会栈溢出，
  // 且一条 NaN 就会让最大值变成 NaN（里程显示 --）
  const latest = maxOf(fuelList.map(r => r.makeMileages), car.mileages);
  const mileages = fuelList.map(r => r.makeMileages);
  const increased = mileages.length > 1 ? maxOf(mileages) - minOf(mileages) : 0;
  // R-07：加油与充电记录 / 区间分开统计，避免把 L 与 kWh 混加
  const isEv = (e: { energyType?: string }) => e.energyType === 'ev';
  const fuelOnlyList = fuelList.filter(r => !isEv(r));
  const evList = fuelList.filter(isEv);
  const fuelSegList = segList.filter(c => !isEv(c));
  const evSegList = segList.filter(isEv);
  const fuelMileage = fuelSegList.reduce((s, c) => s + c.mileage, 0);
  const evMileage = evSegList.reduce((s, c) => s + c.mileage, 0);
  // 趋势图与月度行程按车辆主口径选一组，保证单位一致
  const primarySegs = car.energyType === 'ev' ? evSegList : fuelSegList;

  // ---------- 油耗 / 电耗 / 支出 ----------
  const totalFuelCost = round2(fuelOnlyList.reduce((s, r) => s + r.actualPayAmount, 0));
  const totalChargeCost = round2(evList.reduce((s, r) => s + r.actualPayAmount, 0));
  const sumFuelAmount = fuelSegList.reduce((s, c) => s + c.fuelAmount, 0);
  const sumChargeEnergy = evSegList.reduce((s, c) => s + c.fuelAmount, 0);
  const totalCost = round2(costList.reduce((s, c) => s + c.amount, 0));

  const avgConsumption = fuelMileage > 0
    ? clampFuelConsumption((sumFuelAmount / fuelMileage) * 100)
    : 0;
  // 电耗上限独立于油耗：冬季高电耗车型可达 33 kWh/100km，
  // 套用油耗的 30 上限会把真实值截断，让用户误以为电耗改善了
  const evAvgConsumption = evMileage > 0
    ? Math.min(MAX_EV_CONSUMPTION, (sumChargeEnergy / evMileage) * 100)
    : 0;
  const fuelCostPerKm = fuelMileage > 0 ? totalFuelCost / fuelMileage : 0;
  const chargeCostPerKm = evMileage > 0 ? totalChargeCost / evMileage : 0;
  const expensePerKm = increased > 0 ? totalCost / increased : 0;
  // 分子可能为负（油费来自加油记录，而关联 cost 可能未计入 totalCost），
  // 负的「除掉油费」无意义，钳到 0
  const exEnergy = totalCost - totalFuelCost - totalChargeCost;
  const expensePerKmExFuel = increased > 0 ? Math.max(0, exEnergy) / increased : 0;

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

  // ---------- 趋势聚合（粒度跟随区间，BR-23） ----------
  const trendGranularity = trendGranularityOf(range);
  const monthlyMileage = groupByMonth(primarySegs, c => c.endDate, c => c.mileage);
  const monthlyCost = groupByMonth(costList, c => c.costDate, c => c.amount);
  const mileageTrend = groupByGranularity(primarySegs, c => c.endDate, c => c.mileage, trendGranularity);
  const costTrend = groupByGranularity(costList, c => c.costDate, c => c.amount, trendGranularity);

  return {
    mileage: { latest, increased, fuelMileage, evMileage },
    fuel: { totalCost: totalFuelCost, avgConsumption: round2(avgConsumption), costPerKm: round3(fuelCostPerKm) },
    electricity: {
      totalCost: totalChargeCost,
      energy: round2(sumChargeEnergy),
      mileage: evMileage,
      avgConsumption: round2(evAvgConsumption),
      costPerKm: round3(chargeCostPerKm)
    },
    expense: { total: totalCost, perKm: round3(expensePerKm), perKmExFuel: round3(expensePerKmExFuel) },
    categories: categoriesOut,
    consumptionTrend: primarySegs.map(c => ({ date: c.endDate, value: round2(c.fuelConsumption), mileage: c.mileage })),
    monthlyMileage,
    monthlyCost,
    trendGranularity,
    mileageTrend,
    costTrend
  };
}
