// 车辆记录统一流水页（加油 / 保养 / 维修 / 支出），支持分页与下拉刷新
import { getStorage } from '../../store/index';
import { listRefuels, getConsumptions, removeRefuel } from '../../services/refuel.service';
import { listMaintains, listMaintainHandles, listMaintainLogs, removeMaintainHandle } from '../../services/maintain-record.service';
import { listRepairs, removeRepair } from '../../services/repair.service';
import { listCosts, listCategories, removeCost } from '../../services/cost.service';
import { displayIcon, isImageIcon } from '../../utils/icons';
import { getCar, listCars } from '../../services/car.service';
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
    recordNoun: '加油',
    fuelRecords: [] as any[],
    maintainRecords: [] as any[],
    repairRecords: [] as any[],
    costRecords: [] as any[],
    hasMore: false,
    total: 0,
    /** 接力带来的筛选说明（空字符串表示未筛选） */
    filterText: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();

    /**
     * 接力参数：车名 / 类别 / 区间。
     *
     * 之前这里只认 id 和 tab，AI 接力带过来的筛选条件全被丢掉，
     * 用户点进去看到的是默认列表——「调出来一个空白页面」就是这么来的。
     */
    const carName = options.carName ? decodeURIComponent(options.carName) : '';
    let carId = options.id || '';
    if (!carId && carName) {
      // 宽松匹配：接力传的是用户看到的车名，可能与库里差一个空格
      const hit = listCars(storage).find(
        c => c.name === carName || c.name.replace(/\s/g, '') === carName.replace(/\s/g, '')
      );
      carId = hit ? hit.sourceId : '';
    }

    const category = options.category ? decodeURIComponent(options.category) : '';
    const start = options.start ? new Date(options.start).getTime() : 0;
    const end = options.end ? new Date(options.end).getTime() : 0;
    (this as any)._filter = { start, end, category };

    const rangeText = options.start && options.end ? `${options.start.slice(5)} ~ ${options.end.slice(5)}` : '';
    const filterText = [carName, category, rangeText].filter(Boolean).join(' · ');

    const tab = (['fuel', 'maintain', 'repair', 'cost'] as string[]).includes(options.tab)
      ? options.tab
      : category
        ? 'cost'
        : 'fuel';

    // R-07：Tab 文案随车型变化，避免纯电车点「查看全部充电记录」进来仍显示「加油」
    const car = getCar(storage, carId);
    const energyType = car?.energyType || 'fuel';
    const recordNoun =
      energyType === 'ev' ? '充电' : energyType === 'hybrid' ? '加油/充电' : '加油';
    this.setData({ carId, activeTab: tab, recordNoun, filterText });
  },

  /** 清掉接力带来的筛选，回到这辆车的全部记录 */
  onClearFilter() {
    (this as any)._filter = {};
    this.setData({ filterText: '' });
    this.load();
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
      content: '删除后可在「设置 → 回收站」中撤销（保留 30 天），确定删除吗？',
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

    // 接力带来的筛选：区间 + 分类（没有就是空对象，等价于不过滤）
    const f: { start?: number; end?: number; category?: string } = (this as any)._filter || {};
    const inRange = (ts: number) => (!f.start || ts >= f.start) && (!f.end || ts >= 0 && ts <= f.end);

    // 加油
    const refuels = listRefuels(storage, carId).filter(r => inRange(r.fuelDate));
    const segs = getConsumptions(storage, carId);
    const fuelRecords = buildFuelRecords(refuels, segs);

    // 保养
    const handles = listMaintainHandles(storage, carId).filter(h => inRange(h.makeDate));
    const logs = listMaintainLogs(storage, carId);
    const maintainMap = new Map(listMaintains(storage, carId).map(m => [m.sourceId, m.name]));
    const maintainRecords = handles.map(h => {
      const names = logs
        .filter(l => l.handleSourceId === h.sourceId)
        .map(l => maintainMap.get(l.maintainSourceId) ?? '未知');
      // 保养项被删除后，其 logs 会连带软删，导致 names 为空、记录只剩日期里程。
      // 回退为明确文案，避免出现空白。
      const namesText = names.length > 0 ? names.join('、') : '保养项已删除';
      const cost = h.costSourceId ? storage.get<Cost>('costs', h.costSourceId) : null;
      return {
        sourceId: h.sourceId,
        dateText: formatDateTime(h.makeDate),
        mileage: h.makeMileages,
        names: namesText,
        amountText: cost && !cost.deleted ? cost.amount.toFixed(2) : '--'
      };
    });

    // 维修
    const repairRecords = listRepairs(storage, carId)
      .filter(r => inRange(r.repairDate))
      .map(r => ({
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
      .filter(c => inRange(c.costDate))
      // 分类筛选：接力传的是分类名（「停车」），按名字包含匹配
      .filter(c => !f.category || (catMap.get(c.categorySourceId)?.name || '').includes(f.category))
      .map(c => ({
        sourceId: c.sourceId,
        emoji: displayIcon(catMap.get(c.categorySourceId)?.icon ?? 'ticket'),
        // 自定义图片图标必须走 <image>，否则会把 wxfile:// 路径当文字渲染
        icon: catMap.get(c.categorySourceId)?.icon ?? '',
        isImage: isImageIcon(catMap.get(c.categorySourceId)?.icon ?? ''),
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
      isCharging: r.energyType === 'ev',
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
