// 全车汇总（数据总览页 / AI queryStats 的全车口径）
//
// 与 buildStats 的关系：buildStats 算「一辆车」，这里算「所有车的合计」。
// 每辆车的明细仍复用 buildStats，保证单车数字与车辆统计页完全一致；
// 合计只做加总，不引入第二套公式。
import { Car, Category, Cost, FuelConsumption, RefuelLog } from '../types/models';
import { round2, round3 } from '../utils/number';
import {
  StatsRange,
  TrendGranularity,
  TrendPoint,
  buildStats,
  groupByGranularity,
  resolveRange,
  trendGranularityOf,
  CHART_COLORS,
  TREND_GRANULARITY_LABEL
} from './stats.service';

export interface SummaryCarRow {
  carSourceId: string;
  name: string;
  energyType: string;
  /** 区间内该车支出 */
  totalExpense: number;
  perKm: number;
  /** 区间内的有效里程（首尾记录差） */
  mileage: number;
  /** 平均油耗（L/100km）或电耗（kWh/100km），0 = 无有效区间 */
  consumption: number;
  consumptionUnit: string;
}

export interface SummarySnapshot {
  carCount: number;
  /** 所有车的有效里程之和 */
  mileageIncreased: number;
  expense: {
    total: number;
    perKm: number;
    /** 去掉油费/电费后的每公里 */
    perKmExEnergy: number;
    energyTotal: number;
    energyPercent: number;
  };
  categories: Array<{
    categorySourceId: string;
    name: string;
    amount: number;
    percent: number;
    color: string;
    /** 该分类的笔数 */
    count: number;
  }>;
  trendGranularity: TrendGranularity;
  costTrend: TrendPoint[];
  energyTrend: TrendPoint[];
  cars: SummaryCarRow[];
}

/** 最多列出几类支出（超出后归入「其他」，避免图例过长） */
const MAX_CATEGORIES = 6;

/**
 * 全车汇总。入参须为**软删除过滤后**的现存数据。
 *
 * 里程口径：各车「首尾记录差」相加——不是「最新里程之和」。
 * 前者才是这段时间真实跑了多少，后者是车的总表里程，混用会让每公里成本算小。
 */
export function buildSummary(
  range: StatsRange,
  costs: Cost[],
  refuels: RefuelLog[],
  consumptions: FuelConsumption[],
  categories: Category[],
  cars: Car[]
): SummarySnapshot {
  const { start, end } = resolveRange(range);
  const inRange = (t: number) => t >= start && t <= end;
  const costList = costs.filter(c => inRange(c.costDate));

  const total = round2(costList.reduce((s, c) => s + c.amount, 0));
  // 油费/电费：由加油/充电联动生成的支出（带 fuelRecordSourceId）
  const energyCosts = costList.filter(c => !!c.fuelRecordSourceId);
  const energyTotal = round2(energyCosts.reduce((s, c) => s + c.amount, 0));

  // ---------- 每辆车：复用 buildStats，口径与车辆统计页同源 ----------
  const rows: SummaryCarRow[] = cars.map(car => {
    const snap = buildStats(
      range,
      costs.filter(c => c.carSourceId === car.sourceId),
      refuels.filter(r => r.carSourceId === car.sourceId),
      consumptions.filter(x => x.carSourceId === car.sourceId),
      categories,
      car
    );
    const isEv = car.energyType === 'ev';
    const consumption = isEv ? snap.electricity.avgConsumption : snap.fuel.avgConsumption;
    const hasSeg = isEv ? snap.electricity.mileage > 0 : snap.mileage.fuelMileage > 0;
    return {
      carSourceId: car.sourceId,
      name: car.name,
      energyType: car.energyType,
      totalExpense: snap.expense.total,
      perKm: snap.expense.perKm,
      mileage: snap.mileage.increased,
      consumption: hasSeg ? consumption : 0,
      consumptionUnit: isEv ? 'kWh/100km' : 'L/100km'
    };
  });

  const mileageIncreased = rows.reduce((s, r) => s + r.mileage, 0);
  const perKm = mileageIncreased > 0 ? total / mileageIncreased : 0;
  // 分子可能为负（联动支出未计入 total 时），负的「去掉能耗」无意义
  const perKmExEnergy = mileageIncreased > 0 ? Math.max(0, total - energyTotal) / mileageIncreased : 0;

  // ---------- 分类（全车合并，降序，最大余数补齐 100%） ----------
  // 记笔数：回复「今年加油花了多少」时说「12 次 · ¥4,180」才算给了明细
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const c of costList) {
    const hit = byCategory.get(c.categorySourceId) || { amount: 0, count: 0 };
    hit.amount += c.amount;
    hit.count += 1;
    byCategory.set(c.categorySourceId, hit);
  }
  const merged = [...byCategory.entries()]
    .map(([id, agg]) => ({
      categorySourceId: id,
      name: categories.find(x => x.sourceId === id)?.name ?? '其他',
      amount: round2(agg.amount),
      percent: total > 0 ? round2((agg.amount / total) * 100) : 0,
      count: agg.count,
      color: ''
    }))
    .sort((a, b) => b.amount - a.amount);

  // 超过 6 类时把尾部合并成「其他」，图例才不会挤成两行
  const head = merged.slice(0, MAX_CATEGORIES);
  const tail = merged.slice(MAX_CATEGORIES);
  if (tail.length) {
    const restAmount = round2(tail.reduce((s, x) => s + x.amount, 0));
    const restCount = tail.reduce((s, x) => s + x.count, 0);
    head.push({
      categorySourceId: '__other__',
      name: '其他',
      amount: restAmount,
      percent: total > 0 ? round2((restAmount / total) * 100) : 0,
      count: restCount,
      color: ''
    });
  }
  if (head.length && total > 0) {
    const diff = round2(100 - head.reduce((s, x) => s + x.percent, 0));
    head[0].percent = round2(head[0].percent + diff);
  }
  const categoriesOut = head.map((x, i) => ({ ...x, color: CHART_COLORS[i % CHART_COLORS.length] }));

  // ---------- 趋势（粒度跟随区间） ----------
  const granularity = trendGranularityOf(range);

  return {
    carCount: cars.length,
    mileageIncreased,
    expense: {
      total,
      perKm: round3(perKm),
      perKmExEnergy: round3(perKmExEnergy),
      energyTotal,
      energyPercent: total > 0 ? round2((energyTotal / total) * 100) : 0
    },
    categories: categoriesOut,
    trendGranularity: granularity,
    costTrend: groupByGranularity(costList, c => c.costDate, c => c.amount, granularity, range.type === 'custom'),
    energyTrend: groupByGranularity(energyCosts, c => c.costDate, c => c.amount, granularity, range.type === 'custom'),
    cars: rows.sort((a, b) => b.totalExpense - a.totalExpense)
  };
}

/** 粒度中文名：统一从 stats.service 取，避免两处各写一份 */
export const GRANULARITY_LABEL = TREND_GRANULARITY_LABEL;
