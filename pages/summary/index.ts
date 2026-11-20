// 数据总览（全车汇总）
//
// 与「车辆统计页」的区别只有一处：这里算的是**所有车的合计**。
// 版式与统计页保持一致（维度切换 → 指标卡 → 柱状图 → 分类 → 各车明细），用户不用学两套。
//
// 它是普通页（非 tabBar）——AI 接力时能带 rangeType/year/month 参数，
// 落到这里就是用户问的那个区间；tabBar 页会被 switchTab 丢掉 query。
import { getStorage } from '../../store/index';
import { listCars } from '../../services/car.service';
import { listCategories, listCosts } from '../../services/cost.service';
import { listRefuels } from '../../services/refuel.service';
import { buildOverview } from '../../services/overview.service';
import { rebuildConsumptionsGrouped } from '../../domain/fuel.service';
import { GRANULARITY_LABEL, buildSummary, SummarySnapshot } from '../../domain/summary.service';
import { StatsRange, TrendGranularity } from '../../domain/stats.service';
import { Car, Category, Cost, FuelConsumption, RefuelLog } from '../../types/models';
import { formatCompact } from '../../utils/num-format';
import { applyPageSkin } from '../../utils/skin';
import { takeAgentHandoff } from '../../utils/agent-handoff';

interface BarView {
  label: string;
  /** 高度百分比（相对最大值） */
  height: string;
  /** 左偏移百分比：只画有数据的柱子，横轴仍按真实位置 */
  left: string;
  /** 宽度百分比 */
  width: string;
  value: string;
}

interface AxisTick {
  text: string;
  left: string;
}

interface CarRowView {
  carSourceId: string;
  name: string;
  subText: string;
  totalText: string;
  color: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

Page({
  data: {
    pageStyle: '',
    rangeType: 'year' as 'month' | 'year' | 'all',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    years: [] as number[],
    months: MONTHS,
    hasCar: true,
    carCount: '0',
    mileageText: '0',
    pendingCount: '0',
    totalText: '¥0.00',
    perKmText: '¥0.000',
    energyPercentText: '0%',
    /** 图表粒度角标：日 / 月 / 年 */
    granularityLabel: '月',
    bars: [] as BarView[],
    axis: [] as AxisTick[],
    catRows: [] as Array<{ name: string; amountText: string; percent: string; color: string; width: string }>,
    carRows: [] as CarRowView[],
    emptyChart: false,
    /** 是否由小微卡片接力进入（仅用于埋点/调试，不影响渲染） */
    fromAgent: false
  },

  onLoad(query: Record<string, string>) {
    applyPageSkin(this);
    // 从小微卡片接力进来时取走 payload（读完即删）
    const handoff = takeAgentHandoff(this);
    const now = new Date();
    const type = query.rangeType === 'month' ? 'month' : query.rangeType === 'all' ? 'all' : 'year';
    const year = Number(query.year) || now.getFullYear();
    const month = Math.min(12, Math.max(1, Number(query.month) || now.getMonth() + 1));

    const storage = getStorage();
    const years = this.buildYears(storage);

    this.setData(
      {
        rangeType: type,
        year,
        month,
        years,
        fromAgent: !!handoff
      },
      () => this.load()
    );
  },

  onShow() {
    this.load();
  },

  /** 年份列表：最近 6 年 + 数据里出现过的年份，新的在前 */
  buildYears(storage: ReturnType<typeof getStorage>): number[] {
    const now = new Date().getFullYear();
    const set = new Set<number>();
    for (let i = 0; i < 6; i++) set.add(now - i);
    for (const c of listCars(storage)) {
      for (const cost of listCosts(storage, c.sourceId)) {
        set.add(new Date(cost.costDate).getFullYear());
      }
    }
    return [...set].sort((a, b) => b - a);
  },

  load() {
    const storage = getStorage();
    const cars = listCars(storage);
    if (!cars.length) {
      this.setData({ hasCar: false });
      return;
    }

    const range = this.currentRange();
    const categories = listCategories(storage);

    // 全车数据：按车取，再拼成一份（buildSummary 内部再按车拆回 buildStats）
    const costs: Cost[] = [];
    const refuels: RefuelLog[] = [];
    const consumptions: FuelConsumption[] = [];
    for (const car of cars) {
      const carRefuels = listRefuels(storage, car.sourceId);
      costs.push(...listCosts(storage, car.sourceId));
      refuels.push(...carRefuels);
      consumptions.push(...rebuildConsumptionsGrouped([...carRefuels].sort((a, b) => a.fuelDate - b.fuelDate)));
    }

    const snap: SummarySnapshot = buildSummary(range, costs, refuels, consumptions, categories, cars);
    const overview = buildOverview(storage, Date.now());

    const granularity: TrendGranularity = snap.trendGranularity;
    const bars = this.buildBars(snap.costTrend.map(p => ({ label: p.label, value: p.value })), granularity, range);

    this.setData({
      hasCar: true,
      carCount: String(snap.carCount),
      mileageText: formatCompact(snap.mileageIncreased),
      pendingCount: String(overview.pendingCount),
      totalText: `¥${formatCompact(snap.expense.total)}`,
      perKmText: `¥${snap.expense.perKm.toFixed(3)}`,
      energyPercentText: `${snap.expense.energyPercent}%`,
      granularityLabel: GRANULARITY_LABEL[granularity],
      bars: bars.bars,
      axis: bars.axis,
      emptyChart: bars.bars.length === 0,
      catRows: snap.categories.map(c => ({
        name: c.name,
        amountText: `¥${c.amount.toFixed(2)}`,
        percent: `${c.percent}%`,
        color: c.color,
        // 条宽用占比，最短留 4% 免得看不见
        width: `${Math.max(4, c.percent)}%`
      })),
      carRows: snap.cars.map((c, i) => ({
        carSourceId: c.carSourceId,
        name: c.name,
        subText:
          c.consumption > 0
            ? `${c.consumptionUnit === 'kWh/100km' ? '电耗' : '油耗'} ${c.consumption.toFixed(2)} ${c.consumptionUnit} · ${c.mileage} km`
            : `暂无有效${c.consumptionUnit === 'kWh/100km' ? '电耗' : '油耗'}区间 · ${c.mileage} km`,
        totalText: `¥${c.totalExpense.toFixed(2)}`,
        color: snap.categories.length ? ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#14B8A6'][i % 6] : '#3B82F6'
      }))
    });
  },

  currentRange(): StatsRange {
    const { rangeType, year, month } = this.data;
    if (rangeType === 'all') return { type: 'all' };
    if (rangeType === 'month') return { type: 'month', year, month };
    return { type: 'year', year };
  },

  /**
   * 柱状图数据。
   *
   * 「只画有数据的桶，横轴按真实位置」——月视图下 31 根柱子每根不到 9rpx，
   * 全画会糊成一片；按真实位置定位则能看出「哪几天花了钱、中间空了多久」。
   */
  buildBars(points: Array<{ label: string; value: number }>, granularity: TrendGranularity, range: StatsRange) {
    if (!points.length) return { bars: [] as BarView[], axis: [] as AxisTick[] };

    const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
    const slotCount = granularity === 'day' ? 31 : granularity === 'month' ? 12 : points.length;

    // 每个点落在第几个槽位
    const slotOf = (label: string): number => {
      if (granularity === 'day') return Math.max(0, Number(label) - 1);
      if (granularity === 'month') {
        // 跨年时 label 形如 2026-03 / 3月，取月份数字
        const m = Number((label.match(/(\d+)(?!.*\d)/) || [])[1]);
        return Math.max(0, (m || 1) - 1);
      }
      return points.findIndex(p => p.label === label);
    };

    const slotWidth = 100 / slotCount;
    const bars: BarView[] = points.map(p => {
      const slot = slotOf(p.label);
      return {
        label: p.label,
        height: `${Math.max(3, Math.round((p.value / max) * 100))}%`,
        left: `${(slot * slotWidth).toFixed(2)}%`,
        // 留一点间隙，柱子才不会连成一整块
        width: `${(slotWidth * 0.72).toFixed(2)}%`,
        value: `¥${p.value.toFixed(2)}`
      };
    });

    const axis: AxisTick[] = [];
    if (granularity === 'day') {
      for (const d of [1, 5, 10, 15, 20, 25, 30]) {
        axis.push({ text: String(d), left: `${((d - 1) * slotWidth).toFixed(2)}%` });
      }
    } else if (granularity === 'month') {
      for (let m = 1; m <= 12; m++) {
        axis.push({ text: String(m), left: `${((m - 1) * slotWidth).toFixed(2)}%` });
      }
    } else {
      points.forEach((p, i) => {
        axis.push({ text: p.label, left: `${(i * slotWidth).toFixed(2)}%` });
      });
    }

    return { bars, axis };
  },

  onRangeChange(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as 'month' | 'year' | 'all';
    this.setData({ rangeType: type }, () => this.load());
  },

  onYearChange(e: WechatMiniprogram.PickerChange) {
    // picker 的 value 是索引，不是年份本身
    const idx = Number(e.detail.value);
    this.setData({ year: this.data.years[idx] }, () => this.load());
  },

  onMonthChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ month: Number(e.detail.value) + 1 }, () => this.load());
  },

  /** 各车明细 → 单车统计页，并把当前区间带过去 */
  onTapCar(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    const { rangeType, year, month } = this.data;
    const q = rangeType === 'month' ? `&year=${year}&month=${month}` : rangeType === 'year' ? `&year=${year}` : '';
    wx.navigateTo({ url: `/pages/statistics/index?id=${id}&range=${rangeType}${q}` });
  },

  onBack() {
    wx.navigateBack();
  }
});
