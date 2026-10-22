// 车辆详情（含加油记录 + 近期支出）
import { getStorage } from '../../store/index';
import { getCar } from '../../services/car.service';
import { listRefuels, getConsumptions, getLatestConsumption } from '../../services/refuel.service';
import { listCosts, listCategories } from '../../services/cost.service';
import { getMaintainProgress, ensureMaintainTemplates } from '../../services/maintain-record.service';
import { buildStats } from '../../domain/stats.service';
import { iconEmoji } from '../../utils/icons';
import { formatDateTime, formatDate } from '../../utils/date';
import { FuelConsumption, RefuelLog } from '../../types/models';

interface RecordView {
  sourceId: string;
  dateText: string;
  mileage: number;
  priceText: string;
  volumeText: string;
  amountText: string;
  isFull: boolean;
  isLowFuel: boolean;
  remark: string;
  seg: { consumption: string; costPerKm: string; mileage: number } | null;
}

interface CostView {
  sourceId: string;
  emoji: string;
  name: string;
  dateText: string;
  remark: string;
  amountText: string;
}

interface MaintainProgressView {
  name: string;
  remainText: string;
  progressPercent: number;
  urgent: boolean;
}

Page({
  data: {
    carId: '',
    carName: '',
    mileages: 0,
    // 最近油耗
    hasLatest: false,
    latestConsumptionText: '--',
    latestMileageText: '--',
    latestCostPerKmText: '--',
    // 今年统计
    currentYear: new Date().getFullYear(),
    yearAvgText: '--',
    yearExpenseText: '--',
    yearMileageText: '--',
    records: [] as RecordView[],
    recentCosts: [] as CostView[],
    maintainProgress: [] as MaintainProgressView[],
    maintainTotal: 0
  },
  onLoad(options: Record<string, string>) {
    this.setData({ carId: options.id });
  },
  onShow() {
    this.load();
  },
  load() {
    const storage = getStorage();
    const car = getCar(storage, this.data.carId);
    if (!car) return;

    const refuels = listRefuels(storage, car.sourceId);
    const segs = getConsumptions(storage, car.sourceId);
    const latest = getLatestConsumption(storage, car.sourceId);
    const costsAll = listCosts(storage, car.sourceId);
    const categories = listCategories(storage);
    const nowYear = new Date().getFullYear();
    const yearSnap = buildStats({ type: 'year', year: nowYear }, costsAll, refuels, segs, categories, car);

    ensureMaintainTemplates(storage, car.sourceId);
    const allProgress = getMaintainProgress(storage, car.sourceId, Date.now());
    // 只展示"快要保养"（剩余里程/天数 ≤ 阈值）的项目，其余进"更多"
    const soonProgress = allProgress.filter(p => p.urgent);
    const maintainProgress = soonProgress.map(p => ({
      name: p.maintain.name,
      remainText:
        p.remainDays !== null
          ? `剩余 ${p.remainDays} 天`
          : p.remainMileage !== null
            ? `剩余 ${p.remainMileage} km`
            : '',
      progressPercent: Math.round(p.progress * 100),
      urgent: p.urgent
    }));

    const catMap = new Map(categories.map(c => [c.sourceId, c]));
    const recentCosts = costsAll.slice(0, 5).map(c => {
      const cat = catMap.get(c.categorySourceId);
      return {
        sourceId: c.sourceId,
        emoji: iconEmoji(cat?.icon ?? 'ticket'),
        name: cat?.name ?? '其他',
        dateText: formatDate(c.costDate),
        remark: c.remark,
        amountText: c.amount.toFixed(2)
      };
    });

    this.setData({
      carName: car.name,
      mileages: car.mileages,
      hasLatest: !!latest,
      latestConsumptionText: latest ? latest.fuelConsumption.toFixed(2) : '--',
      latestMileageText: latest ? String(latest.mileage) : '--',
      latestCostPerKmText: latest ? latest.costPerKm.toFixed(2) : '--',
      currentYear: nowYear,
      yearAvgText: yearSnap.mileage.fuelMileage > 0 ? yearSnap.fuel.avgConsumption.toFixed(2) : '--',
      yearExpenseText: yearSnap.expense.total.toFixed(2),
      yearMileageText: String(yearSnap.mileage.fuelMileage),
      records: buildRecords(refuels, segs),
      recentCosts,
      maintainProgress,
      maintainTotal: allProgress.length
    });
  },
  onAddRefuel() {
    wx.navigateTo({ url: `/pages/refuel-form/index?carId=${this.data.carId}` });
  },
  onAddCost() {
    wx.navigateTo({ url: `/pages/cost-form/index?carId=${this.data.carId}` });
  },
  onAddRepair() {
    wx.navigateTo({ url: `/pages/repair-form/index?carId=${this.data.carId}` });
  },
  onAddMaintain() {
    wx.navigateTo({ url: `/pages/maintain-form/index?carId=${this.data.carId}` });
  },
  onManageMaintain() {
    wx.navigateTo({ url: `/pages/maintain-manage/index?id=${this.data.carId}` });
  },
  onManageThreshold() {
    wx.navigateTo({ url: `/pages/maintain-threshold/index?id=${this.data.carId}` });
  },
  onExplainMileage() {
    wx.showModal({
      title: '什么是有效里程',
      content:
        '有效里程 = 本年度参与油耗统计的行驶里程之和。\n\n只有「本次加满，且上次加满或为低油量补油」的相邻两次加油，才构成一段有效区间，其里程 = 本次加油里程 − 上次加油里程。\n\n未加满的加油不构成完整区间，这段行驶里程不计入，所以有效里程会小于车辆总里程。\n\n年平均油耗 = 本年度区间油耗量 ÷ 本年度有效里程。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#3B6FF6'
    });
  },
  onOpenStatistics() {
    wx.navigateTo({ url: `/pages/statistics/index?id=${this.data.carId}` });
  },
  onOpenStatisticsYear() {
    wx.navigateTo({ url: `/pages/statistics/index?id=${this.data.carId}&range=year` });
  },
  onOpenRecords() {
    wx.navigateTo({ url: `/pages/records/index?id=${this.data.carId}` });
  }
});

function buildRecords(refuels: RefuelLog[], segs: FuelConsumption[]): RecordView[] {
  const segByEnd = new Map(segs.map(c => [c.endFuelRecordSourceId, c]));
  return refuels.map(r => {
    const seg = segByEnd.get(r.sourceId) ?? null;
    return {
      sourceId: r.sourceId,
      dateText: formatDateTime(r.fuelDate),
      mileage: r.makeMileages,
      priceText: r.unitPrice.toFixed(2),
      volumeText: r.volume.toFixed(2),
      amountText: r.actualPayAmount.toFixed(2),
      isFull: r.isFull,
      isLowFuel: r.isLowFuel,
      remark: r.remark,
      seg: seg
        ? {
            consumption: seg.fuelConsumption.toFixed(2),
            costPerKm: seg.costPerKm.toFixed(2),
            mileage: seg.mileage
          }
        : null
    };
  });
}
