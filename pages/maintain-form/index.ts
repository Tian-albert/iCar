// 记一笔保养（多选保养项，支持新建 / 编辑）
import { getStorage } from '../../store/index';
import {
  ensureMaintainTemplates,
  listMaintains,
  saveMaintainHandle,
  updateMaintainHandle,
  formatCycle
} from '../../services/maintain-record.service';
import { getCar } from '../../services/car.service';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';
import { MaintainHandle, MaintainLog } from '../../types/models';

interface MaintainView {
  sourceId: string;
  name: string;
  cycleText: string;
  selected: boolean;
}

Page({
  data: {
    carId: '',
    recordId: '',
    maintains: [] as MaintainView[],
    mileages: '',
    dateText: formatDate(Date.now()),
    dateValue: Date.now(),
    amount: '',
    remark: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const car = getCar(storage, options.carId);
    if (!car) return;
    ensureMaintainTemplates(storage, car.sourceId);

    let selectedIds: string[] = [];
    if (options.recordId) {
      const logs = storage
        .list<MaintainLog>('maintainLogs')
        .filter(l => l.handleSourceId === options.recordId && !l.deleted);
      selectedIds = logs.map(l => l.maintainSourceId);
    }

    const maintains = listMaintains(storage, car.sourceId).map(m => ({
      sourceId: m.sourceId,
      name: m.name,
      cycleText: formatCycle(m),
      selected: selectedIds.includes(m.sourceId)
    }));

    const patch: Record<string, any> = { carId: car.sourceId, maintains, mileages: String(car.mileages) };
    if (options.recordId) {
      const h = storage.get<MaintainHandle>('maintainHandles', options.recordId);
      if (h && !h.deleted) {
        patch.recordId = h.sourceId;
        patch.mileages = String(h.makeMileages);
        patch.dateText = formatDate(h.makeDate);
        patch.dateValue = h.makeDate;
        patch.remark = h.remark;
      }
    }
    this.setData(patch);
    wx.setNavigationBarTitle({ title: options.recordId ? '编辑保养' : '记保养' });
  },
  onShow() {
    if (!this.data.carId) return;
    this.refreshMaintains();
  },
  /** 刷新保养项列表（周期可能刚被编辑过），保留已勾选状态 */
  refreshMaintains() {
    const selectedIds = new Set(this.data.maintains.filter(m => m.selected).map(m => m.sourceId));
    const list = listMaintains(getStorage(), this.data.carId).map(m => ({
      sourceId: m.sourceId,
      name: m.name,
      cycleText: formatCycle(m),
      selected: selectedIds.has(m.sourceId)
    }));
    this.setData({ maintains: list });
  },
  onManageMaintain() {
    wx.navigateTo({ url: `/pages/maintain-manage/index?id=${this.data.carId}` });
  },
  /** 记录保养时直接编辑该保养项的周期 */
  onEditCycle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}&id=${id}` });
  },
  onToggleMaintain(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const key = `maintains[${index}].selected`;
    this.setData({ [key]: !this.data.maintains[index].selected });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ mileages: e.detail.value });
  },
  onDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ dateText: text, dateValue: new Date(y, m - 1, d).getTime() });
  },
  onAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ amount: e.detail.value });
  },
  onRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value });
  },
  onSave() {
    const selectedIds = this.data.maintains.filter(m => m.selected).map(m => m.sourceId);
    if (selectedIds.length === 0) {
      wx.showToast({ title: '请至少选择一个保养项', icon: 'none' });
      return;
    }
    const mileageNum = Number(this.data.mileages);
    if (!this.data.mileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    const amountStr = this.data.amount;
    const amountNum = amountStr ? Number(amountStr) : NaN;
    const amount = !amountStr || isNaN(amountNum) || amountNum <= 0 ? null : round2(amountNum);

    const form = {
      carSourceId: this.data.carId,
      maintainSourceIds: selectedIds,
      makeDate: this.data.dateValue,
      makeMileages: mileageNum,
      amount,
      remark: this.data.remark
    };
    const storage = getStorage();
    if (this.data.recordId) {
      updateMaintainHandle(storage, this.data.recordId, form);
    } else {
      saveMaintainHandle(storage, form);
    }

    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
