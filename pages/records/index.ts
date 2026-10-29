// 车辆记录统一流水页（加油 / 保养 / 维修 / 支出），支持分页与下拉刷新
import { getStorage } from '../../store/index';
import { listRefuels, getConsumptions, removeRefuel } from '../../services/refuel.service';
import { listMaintains, listMaintainHandles, listMaintainLogs, removeMaintainHandle } from '../../services/maintain-record.service';
import { listRepairs, removeRepair } from '../../services/repair.service';
import { listCosts, listCategories, removeCost } from '../../services/cost.service';
import { iconEmoji } from '../../utils/icons';
import { formatDateTime } from '../../utils/date';
import { Cost, FuelConsumption, RefuelLog } from '../../types/models';

type TabKey = 'fuel' | 'maintain' | 'repair' | 'cost';

const PAGE_SIZE = 20;

const TAB_FIELD: Record<TabKey, string> = {
  fuel: 'fuelRecords',
  maintain: 'maintainRecords',
  repair: 'repairRecords',
  cost: 'costRecords'
};

Page({
  data: {
    carId: '',
    activeTab: 'fuel',
    fuelRecords: [] as any[],
    maintainRecords: [] as any[],
    repairRecords: [] as any[],
    costRecords: [] as any[],
    hasMore: false,
    total: 0
  },
  onLoad(options: Record<string, string>) {
    const tab = (['fuel', 'maintain', 'repair', 'cost'] as string[]).includes(options.tab)
      ? options.tab
      : 'fuel';
    this.setData({ carId: options.id, activeTab: tab });
  },
  onShow() {
    this.load();
  },
  onTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as TabKey;
    this.setData({ activeTab: tab });
    this.renderTab(tab);
  },
  /** 触底加载下一页（仅当前 Tab） */
  onReachBottom() {
    const tab = this.data.activeTab as TabKey;
    const self = this as any;
    const all: any[] = self.allRecords?.[tab] ?? [];
    if ((self.shownCount?.[tab] ?? 0) >= all.length) return;
    self.shownCount[tab] = Math.min(self.shownCount[tab] + PAGE_SIZE, all.length);
    this.renderTab(tab);
  },
  /** 下拉刷新：重新读取全量并回到第一页 */
  onPullDownRefresh() {
    this.load();
    wx.stopPullDownRefresh();
  },
  /** 渲染指定 Tab 的已加载切片 */
  renderTab(tab: TabKey) {
    const self = this as any;
    const all: any[] = self.allRecords?.[tab] ?? [];
    const shown = self.shownCount?.[tab] ?? 0;
    const patch: Record<string, any> = {
      [TAB_FIELD[tab]]: all.slice(0, shown),
      hasMore: shown < all.length,
      total: all.length
    };
    this.setData(patch);
  },
  onEdit(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as string;
    const id = e.currentTarget.dataset.id as string;
    const urlMap: Record<string, string> = {
      fuel: `/pages/refuel-form/index?carId=${this.data.carId}&recordId=${id}`,
      maintain: `/pages/maintain-form/index?carId=${this.data.carId}&recordId=${id}`,
      repair: `/pages/repair-form/index?carId=${this.data.carId}&recordId=${id}`,
      cost: `/pages/cost-form/index?carId=${this.data.carId}&recordId=${id}`
    };
    wx.navigateTo({ url: urlMap[type] });
  },
  onDelete(e: WechatMiniprogram.TouchEvent) {
    const type = e.currentTarget.dataset.type as string;
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除记录',
      content: '删除后不可恢复，确定删除吗？',
      confirmColor: '#F5474F',
      success: res => {
        if (!res.confirm) return;
        const storage = getStorage();
        if (type === 'fuel') removeRefuel(storage, id);
        else if (type === 'maintain') removeMaintainHandle(storage, id);
        else if (type === 'repair') removeRepair(storage, id);
        else if (type === 'cost') removeCost(storage, id);
        this.load();
      }
    });
  },
  load() {
    const storage = getStorage();
    const carId = this.data.carId;

    // 加油
    const refuels = listRefuels(storage, carId);
    const segs = getConsumptions(storage, carId);
    const fuelRecords = buildFuelRecords(refuels, segs);

    // 保养
    const handles = listMaintainHandles(storage, carId);
    const logs = listMaintainLogs(storage, carId);
    const maintainMap = new Map(listMaintains(storage, carId).map(m => [m.sourceId, m.name]));
    const maintainRecords = handles.map(h => {
      const names = logs
        .filter(l => l.handleSourceId === h.sourceId)
        .map(l => maintainMap.get(l.maintainSourceId) ?? '未知');
      const cost = h.costSourceId ? storage.get<Cost>('costs', h.costSourceId) : null;
      return {
        sourceId: h.sourceId,
        dateText: formatDateTime(h.makeDate),
        mileage: h.makeMileages,
        names: names.join('、'),
        amountText: cost && !cost.deleted ? cost.amount.toFixed(2) : '--'
      };
    });

    // 维修
    const repairRecords = listRepairs(storage, carId).map(r => ({
      sourceId: r.sourceId,
      dateText: formatDateTime(r.repairDate),
      content: r.content,
      mileage: r.mileage,
      amountText: r.amount > 0 ? r.amount.toFixed(2) : '--'
    }));

    // 支出（仅手动记的，排除加油/保养/维修自动生成的流水）
    const catMap = new Map(listCategories(storage).map(c => [c.sourceId, c]));
    const costRecords = listCosts(storage, carId)
      .filter(c => !c.fuelRecordSourceId && !c.maintainHandleSourceId && !c.repairSourceId)
      .map(c => ({
        sourceId: c.sourceId,
        emoji: iconEmoji(catMap.get(c.categorySourceId)?.icon ?? 'ticket'),
        name: catMap.get(c.categorySourceId)?.name ?? '其他',
        dateText: formatDateTime(c.costDate),
        remark: c.remark,
        amountText: c.amount.toFixed(2)
      }));

    // 全量缓存到实例（不进 data，避免视图层传输大量数据）
    const self = this as any;
    self.allRecords = { fuel: fuelRecords, maintain: maintainRecords, repair: repairRecords, cost: costRecords };
    self.shownCount = {
      fuel: Math.min(PAGE_SIZE, fuelRecords.length),
      maintain: Math.min(PAGE_SIZE, maintainRecords.length),
      repair: Math.min(PAGE_SIZE, repairRecords.length),
      cost: Math.min(PAGE_SIZE, costRecords.length)
    };

    this.renderTab(this.data.activeTab as TabKey);
  }
});

function buildFuelRecords(refuels: RefuelLog[], segs: FuelConsumption[]) {
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
