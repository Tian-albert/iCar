// 概览页（原「保养」Tab）的跨车聚合。
//
// 设计要点：
// 1. 支出只从 Cost 汇总 —— 加油/充电会自动生成 Cost（refuel.service 写入
//    fuelRecordSourceId），若再叠加加油金额会重复计算。
// 2. 保养项按 progress（剩余比例）升序，0 即已超期，天然排在最前。
// 3. 所有函数只读，不写库，避免仪表盘产生副作用。
import { StorageAdapter } from '../repositories/storage.adapter';
import { listCars } from './car.service';
import { listCategories, listCosts } from './cost.service';
import { listRefuels } from './refuel.service';
import { getMaintainProgress } from './maintain-record.service';
import { getPinnedCarId } from './user.service';
import { CHART_COLORS } from '../domain/stats.service';
import { Car, Cost, RefuelLog } from '../types/models';

/** 待保养预览最多显示几条 */
export const MAINTAIN_PREVIEW = 3;
/** 最近记录显示几条 */
export const RECENT_LIMIT = 3;
/** 超过多少天没记账算「漏记」 */
export const STALE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OverviewMetric {
  carCount: number;
  /** 当前总里程合计（含购车前的里程） */
  totalMileage: number;
  /**
   * 建档后行驶里程合计 = Σ(当前里程 − 购车时里程)。
   *
   * 概览页顶部显示的是这个，而不是 current 总里程：它才是「本 App 记录到的行驶量」，
   * 也是出行成本每公里分母的口径，两者必须一致。
   */
  totalDrivenMileage: number;
  monthCost: number;
  pendingCount: number;
  /** 距最近一次记账的天数；完全没有记录时为 null */
  lastRecordDays: number | null;
}

/**
 * 单车的出行成本（全时段，非本年）。
 *
 * 与 `OverviewCarCost`（本年花费、用于环图占比）不同：
 * 这里是「这辆车从建档到现在总共花了多少、跑了多少、每公里多少钱」。
 */
export interface OverviewDrivingCost {
  carSourceId: string;
  carName: string;
  /** 车辆图标（emoji 或 icon-*.png） */
  icon: string;
  /** 服役天数：建档至今 */
  days: number;
  /** 建档后行驶里程（当前 − 购车时），可能为 0 */
  drivenKm: number;
  /** 全部支出合计（含加油/充电） */
  totalSpend: number;
  /** 每公里成本 = totalSpend / drivenKm；drivenKm 为 0 时为 0 */
  perKm: number;
}

export interface OverviewMaintainItem {
  carSourceId: string;
  carName: string;
  name: string;
  remainText: string;
  /** bad = 已超期，warn = 临近 */
  level: 'bad' | 'warn';
  /** 剩余比例 0~1，越小越紧急 */
  progress: number;
}

export interface OverviewCarCost {
  carSourceId: string;
  carName: string;
  amount: number;
  percent: number;
  color: string;
}

export interface OverviewRecentItem {
  carSourceId: string;
  carName: string;
  date: number;
  typeLabel: string;
  amount: number;
  /** 点击后跳车辆详情的目标区块 */
  section: 'maintain' | 'records' | 'costs';
}

export interface OverviewStale {
  carSourceId: string;
  carName: string;
  days: number;
}

export interface OverviewSnapshot {
  /** 主车（置顶优先，否则第一辆），管理保养项时用 */
  mainCarId: string;
  metric: OverviewMetric;
  maintain: OverviewMaintainItem[];
  /** 待保养项总数（不只预览的几条） */
  pendingCount: number;
  carCosts: OverviewCarCost[];
  yearTotal: number;
  recent: OverviewRecentItem[];
  stale: OverviewStale | null;
  /** 每车出行成本（按建档后里程算每公里成本） */
  drivingCosts: OverviewDrivingCost[];
}

function startOfMonth(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function startOfYear(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/**
 * 百分比取整且保证合计为 100。
 *
 * 三项各 33.33% 时逐项四舍五入会显示 33+33+33=99%，与环图铺满一整圈矛盾。
 * 把差额补给占比最大的一项（入参通常是按金额降序的数组）。
 */
export function toIntegerPercents(values: number[]): number[] {
  const out = values.map(v => Math.round(isFinite(v) ? v : 0));
  if (out.length === 0) return out;

  const diff = 100 - out.reduce((sum, v) => sum + v, 0);
  if (diff !== 0) {
    let maxIndex = 0;
    for (let i = 1; i < out.length; i++) {
      if (out[i] > out[maxIndex]) maxIndex = i;
    }
    out[maxIndex] += diff;
  }
  return out;
}

/** 主车：置顶优先；没置顶过就取第一辆 */
export function pickMainCar(cars: Car[], pinnedId: string): Car | null {
  if (cars.length === 0) return null;
  const pinned = cars.filter(c => c.sourceId === pinnedId)[0];
  return pinned || cars[0];
}

function remainTextOf(remainMileage: number | null, remainDays: number | null): string {
  if (remainDays !== null && remainDays < 0) {
    return `已超期 ${Math.abs(remainDays)} 天`;
  }
  if (remainMileage !== null && remainMileage < 0) {
    return `已超期 ${Math.abs(remainMileage)} km`;
  }
  if (remainDays !== null) return `剩 ${remainDays} 天`;
  if (remainMileage !== null) return `剩 ${remainMileage} km`;
  return '';
}

/** 该车最后一条记录的时间（支出 / 加油取最大）；没有记录时回退到建档时间 */
function lastActivityOf(costs: Cost[], refuels: RefuelLog[], car: Car): number {
  let last = 0;
  for (const c of costs) {
    if (c.costDate > last) last = c.costDate;
  }
  for (const r of refuels) {
    if (r.fuelDate > last) last = r.fuelDate;
  }
  return last > 0 ? last : car.createdAt;
}

export function buildOverview(storage: StorageAdapter, now: number): OverviewSnapshot {
  const cars = listCars(storage);
  const pinnedId = getPinnedCarId(storage);
  const mainCar = pickMainCar(cars, pinnedId);

  const catMap = new Map(listCategories(storage).map(c => [c.sourceId, c.name]));

  const monthStart = startOfMonth(now);
  const yearStart = startOfYear(now);

  let totalMileage = 0;
  let totalDrivenMileage = 0;
  let monthCost = 0;
  let pendingCount = 0;
  let yearTotal = 0;
  let latestRecord = 0;

  const maintain: OverviewMaintainItem[] = [];
  const carCosts: OverviewCarCost[] = [];
  const drivingCosts: OverviewDrivingCost[] = [];
  const allRecent: OverviewRecentItem[] = [];
  const perCarActivity: Array<{ car: Car; last: number; hasRecord: boolean }> = [];

  for (const car of cars) {
    totalMileage += car.mileages || 0;

    // 建档后行驶里程：当前里程 − 购车时里程。可能为负（用户改小了里程），夹到 0
    const drivenKm = Math.max(0, (car.mileages || 0) - (car.initMileages || 0));
    totalDrivenMileage += drivenKm;

    const costs = listCosts(storage, car.sourceId);
    const refuels = listRefuels(storage, car.sourceId);

    // ---- 本月支出 / 今年支出 / 全时段支出（只从 Cost 汇总，避免与加油重复）----
    let carYear = 0;
    let carTotal = 0;
    for (const c of costs) {
      const d = c.costDate || 0;
      if (d >= monthStart && d <= now) monthCost += c.amount;
      if (d >= yearStart && d <= now) carYear += c.amount;
      carTotal += c.amount;
      if (d > latestRecord) latestRecord = d;
    }
    yearTotal += carYear;
    carCosts.push({
      carSourceId: car.sourceId,
      carName: car.name,
      amount: carYear,
      percent: 0,
      color: ''
    });

    // ---- 出行成本（全时段）----
    const initDate = car.initDate || car.createdAt || now;
    const days = Math.max(0, Math.floor((now - initDate) / DAY_MS));
    drivingCosts.push({
      carSourceId: car.sourceId,
      carName: car.name,
      icon: car.icon || '',
      days,
      drivenKm,
      totalSpend: Math.round(carTotal * 100) / 100,
      // 里程为 0 时不做除法，避免 Infinity 传出去
      perKm: drivenKm > 0 ? carTotal / drivenKm : 0
    });

    // ---- 最近记录候选（Cost 即流水；类型用类别名）----
    for (const c of costs) {
      let section: 'maintain' | 'records' | 'costs' = 'costs';
      if (c.fuelRecordSourceId) section = 'records';
      else if (c.maintainHandleSourceId) section = 'maintain';
      allRecent.push({
        carSourceId: car.sourceId,
        carName: car.name,
        date: c.costDate,
        typeLabel: catMap.get(c.categorySourceId) || '支出',
        amount: c.amount,
        section
      });
    }
    for (const r of refuels) {
      if (r.fuelDate > latestRecord) latestRecord = r.fuelDate;
    }

    // ---- 保养 ----
    const progress = getMaintainProgress(storage, car.sourceId, now);
    for (const p of progress) {
      if (!p.urgent) continue;
      pendingCount++;
      const overdue =
        (p.remainMileage !== null && p.remainMileage < 0) ||
        (p.remainDays !== null && p.remainDays < 0);
      maintain.push({
        carSourceId: car.sourceId,
        carName: car.name,
        name: p.maintain.name,
        remainText: remainTextOf(p.remainMileage, p.remainDays),
        level: overdue ? 'bad' : 'warn',
        progress: p.progress
      });
    }

    // ---- 漏记检测 ----
    perCarActivity.push({
      car: car,
      last: lastActivityOf(costs, refuels, car),
      hasRecord: costs.length > 0 || refuels.length > 0
    });
  }

  // 待保养：progress 小的在前；同值时超期优先
  maintain.sort((a, b) => {
    if (a.progress !== b.progress) return a.progress - b.progress;
    const rank = (l: 'bad' | 'warn') => (l === 'bad' ? 0 : 1);
    return rank(a.level) - rank(b.level);
  });

  // 按车花费：金额降序，配色取 CHART_COLORS
  carCosts.sort((a, b) => b.amount - a.amount);
  carCosts.forEach((c, i) => {
    c.percent = yearTotal > 0 ? Math.round((c.amount / yearTotal) * 1000) / 10 : 0;
    c.color = CHART_COLORS[i % CHART_COLORS.length];
  });

  // 最近记录：时间降序，取前 N 条
  allRecent.sort((a, b) => b.date - a.date);
  const recent = allRecent.slice(0, RECENT_LIMIT);

  // 漏记：取「最久没记录」且超过阈值的那辆
  let stale: OverviewStale | null = null;
  for (const item of perCarActivity) {
    const days = Math.floor((now - item.last) / DAY_MS);
    if (days < STALE_DAYS) continue;
    if (!stale || days > stale.days) {
      stale = { carSourceId: item.car.sourceId, carName: item.car.name, days };
    }
  }

  const hasAnyRecord = latestRecord > 0;
  const metric: OverviewMetric = {
    carCount: cars.length,
    totalMileage,
    totalDrivenMileage,
    monthCost: Math.round(monthCost * 100) / 100,
    pendingCount,
    lastRecordDays: hasAnyRecord ? Math.floor((now - latestRecord) / DAY_MS) : null
  };

  // 出行成本：按每公里成本降序，便于横向比较「哪辆更费」
  drivingCosts.sort((a, b) => b.perKm - a.perKm);

  return {
    mainCarId: mainCar ? mainCar.sourceId : '',
    metric,
    maintain: maintain.slice(0, MAINTAIN_PREVIEW),
    pendingCount,
    carCosts,
    yearTotal: Math.round(yearTotal * 100) / 100,
    recent,
    stale,
    drivingCosts
  };
}
