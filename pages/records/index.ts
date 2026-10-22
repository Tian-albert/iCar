// 车辆记录统一流水页（加油 / 保养 / 维修 / 支出）
import { getStorage } from '../../store/index';
import { listRefuels, getConsumptions, removeRefuel } from '../../services/refuel.service';
import { listMaintains, listMaintainHandles, listMaintainLogs, removeMaintainHandle } from '../../services/maintain-record.service';
import { listRepairs, removeRepair } from '../../services/repair.service';
import { listCosts, listCategories, removeCost } from '../../services/cost.service';
import { iconEmoji } from '../../utils/icons';
import { formatDateTime } from '../../utils/date';
import { Cost, FuelConsumption, RefuelLog } from '../../types/models';

Page({
  data: {
    carId: '',
    activeTab: 'fuel',
    fuelRecords: [] as any[],
    maintainRecords: [] as any[],
    repairRecords: [] as any[],
    costRecords: [] as any[]
  },
  onLoad(options: Record<string, string>) {
    this.setData({ carId: options.id });
  },
  onShow() {
    this.load();
  },
  onTabChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ activeTab: e.currentTarget.dataset.tab as string });
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

    this.setData({ fuelRecords, maintainRecords, repairRecords, costRecords });
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
