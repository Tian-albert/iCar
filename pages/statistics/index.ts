// 统计看板（对齐设计报告 5.10）
import { getStorage } from '../../store/index';
import { getCar } from '../../services/car.service';
import { listCosts, listCategories } from '../../services/cost.service';
import { listRefuels } from '../../services/refuel.service';
import { rebuildConsumptions } from '../../domain/fuel.service';
import { buildStats, StatsRange } from '../../domain/stats.service';

interface CatView {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

Page({
  data: {
    carId: '',
    rangeType: 'all',
    year: 0,
    month: 1,
    years: [] as number[],
    months: Array.from({ length: 12 }, (_, i) => i + 1) as number[],
    // 里程（整数）
    mileageLatest: 0,
    mileageIncreased: 0,
    mileageFuel: 0,
    // 油耗
    fuelTotalCost: '--',
    fuelAvgConsumption: '--',
    fuelCostPerKm: '--',
    // 支出
    expenseTotal: '--',
    expensePerKm: '--',
    expensePerKmExFuel: '--',
    categories: [] as CatView[],
    trend: [] as Array<{ label: string; value: number }>,
    monthlyMileage: [] as Array<{ label: string; value: number }>,
    monthlyCost: [] as Array<{ label: string; value: number }>
  },
  onLoad(options: Record<string, string>) {
    const now = new Date();
    this.setData({
      carId: options.id,
      year: now.getFullYear(),
      month: now.getMonth() + 1
    });
  },
  onShow() {
    this.load();
  },
  buildRange(): StatsRange {
    const { rangeType, year, month } = this.data;
    if (rangeType === 'year') return { type: 'year', year };
    if (rangeType === 'month') return { type: 'month', year, month };
    return { type: 'all' };
  },
  load() {
    const storage = getStorage();
    const car = getCar(storage, this.data.carId);
    if (!car) return;

    const costs = listCosts(storage, car.sourceId);
    const refuels = listRefuels(storage, car.sourceId);
    const categories = listCategories(storage);
    const segs = rebuildConsumptions([...refuels].sort((a, b) => a.fuelDate - b.fuelDate));

    const nowYear = new Date().getFullYear();
    const allYears = [
      nowYear,
      ...costs.map(c => new Date(c.costDate).getFullYear()),
      ...refuels.map(r => new Date(r.fuelDate).getFullYear())
    ];
    const minYear = Math.min(...allYears);
    const years: number[] = [];
    for (let y = nowYear; y >= minYear; y--) years.push(y);

    const snap = buildStats(this.buildRange(), costs, refuels, segs, categories, car);

    this.setData({
      years,
      mileageLatest: snap.mileage.latest,
      mileageIncreased: snap.mileage.increased,
      mileageFuel: snap.mileage.fuelMileage,
      fuelTotalCost: snap.fuel.totalCost.toFixed(2),
      fuelAvgConsumption: snap.fuel.avgConsumption.toFixed(2),
      fuelCostPerKm: snap.fuel.costPerKm.toFixed(3),
      expenseTotal: snap.expense.total.toFixed(2),
      expensePerKm: snap.expense.perKm.toFixed(3),
      expensePerKmExFuel: snap.expense.perKmExFuel.toFixed(3),
      categories: snap.categories.map(c => ({
        name: c.name,
        amount: c.amount.toFixed(2),
        percent: c.percent,
        color: c.color
      })),
      trend: snap.consumptionTrend.map(t => ({
        label: `${new Date(t.date).getMonth() + 1}/${new Date(t.date).getDate()}`,
        value: t.value
      })),
      monthlyMileage: snap.monthlyMileage.map(m => ({ label: m.label, value: m.value })),
      monthlyCost: snap.monthlyCost.map(m => ({ label: m.label, value: m.value }))
    });
  },
  onRangeChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ rangeType: e.currentTarget.dataset.type as string });
    this.load();
  },
  onYearChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ year: this.data.years[Number(e.detail.value)] });
    this.load();
  },
  onMonthChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ month: this.data.months[Number(e.detail.value)] });
    this.load();
  }
});
