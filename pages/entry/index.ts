// 记一笔统一入口：加油 / 保养 / 维修 / 支出 四类分段，切换不清空已填内容
import { getStorage } from '../../store/index';
import { getCar } from '../../services/car.service';
import { saveRefuel } from '../../services/refuel.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  saveMaintainHandle,
  formatCycle
} from '../../services/maintain-record.service';
import { saveRepair } from '../../services/repair.service';
import { saveCost, listSpendCategories } from '../../services/cost.service';
import { iconEmoji } from '../../utils/icons';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';

interface TabItem {
  key: string;
  label: string;
}

interface MaintainOption {
  sourceId: string;
  name: string;
  cycleText: string;
  selected: boolean;
}

interface CategoryOption {
  sourceId: string;
  name: string;
  emoji: string;
}

const TABS: TabItem[] = [
  { key: 'fuel', label: '加油' },
  { key: 'maintain', label: '保养' },
  { key: 'repair', label: '维修' },
  { key: 'cost', label: '支出' }
];

Page({
  data: {
    carId: '',
    carName: '',
    activeTab: 'fuel',
    tabs: TABS,
    // 加油
    fuelDateText: '',
    fuelDateValue: 0,
    fuelMileages: '',
    fuelUnitPrice: '',
    fuelVolume: '',
    fuelShouldPayText: '0.00',
    fuelActual: '',
    fuelActualTouched: false,
    fuelFullIndex: 0,
    fuelLowIndex: 1,
    fuelLastIndex: 0,
    fuelRemark: '',
    // 保养
    maintains: [] as MaintainOption[],
    maintainMileages: '',
    maintainDateText: '',
    maintainDateValue: 0,
    maintainAmount: '',
    maintainRemark: '',
    // 维修
    repairContent: '',
    repairMileages: '',
    repairDateText: '',
    repairDateValue: 0,
    repairAmount: '',
    repairRemark: '',
    // 支出
    categories: [] as CategoryOption[],
    selectedCategoryIndex: -1,
    costAmount: '',
    costDateText: '',
    costDateValue: 0,
    costRemark: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const car = getCar(storage, options.carId);
    if (!car) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    ensureMaintainTemplates(storage, car.sourceId);

    const now = Date.now();
    const today = formatDate(now);
    const maintains = listMaintains(storage, car.sourceId).map(m => ({
      sourceId: m.sourceId,
      name: m.name,
      cycleText: formatCycle(m),
      selected: false
    }));
    const categories = this.buildCategories();
    const tab = TABS.some(t => t.key === options.tab) ? options.tab : 'fuel';

    this.setData({
      carId: car.sourceId,
      carName: car.name,
      activeTab: tab,
      fuelDateText: today,
      fuelDateValue: now,
      fuelMileages: String(car.mileages),
      maintainMileages: String(car.mileages),
      maintainDateText: today,
      maintainDateValue: now,
      repairMileages: String(car.mileages),
      repairDateText: today,
      repairDateValue: now,
      costDateText: today,
      costDateValue: now,
      maintains,
      categories,
      selectedCategoryIndex: categories.length ? 0 : -1
    });
    wx.setNavigationBarTitle({ title: '记一笔' });
  },
  onShow() {
    if (!this.data.carId) return;
    // 从类别管理 / 保养项编辑返回时刷新对应列表，保留已填内容与勾选状态
    if (this.data.activeTab === 'cost') this.refreshCategories();
    if (this.data.activeTab === 'maintain') this.refreshMaintains();
  },
  buildCategories(): CategoryOption[] {
    return listSpendCategories(getStorage()).map(c => ({
      sourceId: c.sourceId,
      name: c.name,
      emoji: iconEmoji(c.icon)
    }));
  },
  refreshCategories() {
    const cats = this.buildCategories();
    const curId = this.data.categories[this.data.selectedCategoryIndex]?.sourceId ?? '';
    let idx = cats.findIndex(c => c.sourceId === curId);
    if (idx < 0) idx = cats.length ? 0 : -1;
    this.setData({ categories: cats, selectedCategoryIndex: idx });
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
  onTabChange(e: WechatMiniprogram.TouchEvent) {
    const tab = e.currentTarget.dataset.tab as string;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'cost') this.refreshCategories();
  },
  onManageCategory() {
    wx.navigateTo({ url: '/pages/category-manage/index' });
  },
  onManageMaintain() {
    wx.navigateTo({ url: `/pages/maintain-manage/index?id=${this.data.carId}` });
  },
  /** 记录保养时直接编辑该保养项的周期 */
  onEditCycle(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}&id=${id}` });
  },

  // ---------- 加油 ----------
  onFuelDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ fuelDateText: text, fuelDateValue: new Date(y, m - 1, d).getTime() });
  },
  onFuelMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ fuelMileages: e.detail.value });
  },
  onFuelUnitPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ fuelUnitPrice: e.detail.value });
    this.recalcFuel();
  },
  onFuelVolumeInput(e: WechatMiniprogram.Input) {
    this.setData({ fuelVolume: e.detail.value });
    this.recalcFuel();
  },
  onFuelActualInput(e: WechatMiniprogram.Input) {
    this.setData({ fuelActual: e.detail.value, fuelActualTouched: true });
  },
  recalcFuel() {
    const up = Number(this.data.fuelUnitPrice || 0);
    const vol = Number(this.data.fuelVolume || 0);
    const shouldPay = round2(up * vol);
    const patch: Record<string, string> = { fuelShouldPayText: shouldPay.toFixed(2) };
    if (!this.data.fuelActualTouched) patch.fuelActual = shouldPay.toFixed(2);
    this.setData(patch);
  },
  /** 加油选项：三个两段式开关，点击选择 */
  onFuelOptionSelect(e: WechatMiniprogram.TouchEvent) {
    const field = e.currentTarget.dataset.field as string;
    const index = Number(e.currentTarget.dataset.index);
    if (field === 'full') this.setData({ fuelFullIndex: index });
    else if (field === 'low') this.setData({ fuelLowIndex: index });
    else if (field === 'last') this.setData({ fuelLastIndex: index });
  },
  onFuelRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ fuelRemark: e.detail.value });
  },

  // ---------- 保养 ----------
  onMaintainToggle(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const key = `maintains[${index}].selected`;
    this.setData({ [key]: !this.data.maintains[index].selected });
  },
  onMaintainMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ maintainMileages: e.detail.value });
  },
  onMaintainDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ maintainDateText: text, maintainDateValue: new Date(y, m - 1, d).getTime() });
  },
  onMaintainAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ maintainAmount: e.detail.value });
  },
  onMaintainRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ maintainRemark: e.detail.value });
  },

  // ---------- 维修 ----------
  onRepairContentInput(e: WechatMiniprogram.Input) {
    this.setData({ repairContent: e.detail.value });
  },
  onRepairMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ repairMileages: e.detail.value });
  },
  onRepairDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ repairDateText: text, repairDateValue: new Date(y, m - 1, d).getTime() });
  },
  onRepairAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ repairAmount: e.detail.value });
  },
  onRepairRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ repairRemark: e.detail.value });
  },

  // ---------- 支出 ----------
  onCostCategorySelect(e: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedCategoryIndex: Number(e.currentTarget.dataset.index) });
  },
  onCostAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ costAmount: e.detail.value });
  },
  onCostDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ costDateText: text, costDateValue: new Date(y, m - 1, d).getTime() });
  },
  onCostRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ costRemark: e.detail.value });
  },

  // ---------- 保存 ----------
  onSave() {
    const tab = this.data.activeTab;
    if (tab === 'fuel') this.saveFuel();
    else if (tab === 'maintain') this.saveMaintain();
    else if (tab === 'repair') this.saveRepair();
    else this.saveCost();
  },
  saveFuel() {
    const { carId, fuelMileages, fuelUnitPrice, fuelVolume, fuelActual } = this.data;
    const mileageNum = Number(fuelMileages);
    const priceNum = Number(fuelUnitPrice);
    const volumeNum = Number(fuelVolume);
    if (!fuelMileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    if (!fuelUnitPrice || isNaN(priceNum) || priceNum <= 0) {
      wx.showToast({ title: '请输入单价', icon: 'none' });
      return;
    }
    if (!fuelVolume || isNaN(volumeNum) || volumeNum <= 0) {
      wx.showToast({ title: '请输入加油量', icon: 'none' });
      return;
    }
    const now = new Date();
    const d = new Date(this.data.fuelDateValue);
    const fuelDate = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      now.getHours(),
      now.getMinutes()
    ).getTime();
    const actualNum = Number(fuelActual);

    saveRefuel(getStorage(), {
      carSourceId: carId,
      fuelDate,
      makeMileages: mileageNum,
      unitPrice: priceNum,
      volume: volumeNum,
      actualPayAmount: !fuelActual || isNaN(actualNum) ? null : actualNum,
      isFull: this.data.fuelFullIndex === 0,
      isLowFuel: this.data.fuelLowIndex === 0,
      lastRecorded: this.data.fuelLastIndex === 0,
      remark: this.data.fuelRemark
    });
    this.done();
  },
  saveMaintain() {
    const selectedIds = this.data.maintains.filter(m => m.selected).map(m => m.sourceId);
    if (selectedIds.length === 0) {
      wx.showToast({ title: '请至少选择一个保养项', icon: 'none' });
      return;
    }
    const mileageNum = Number(this.data.maintainMileages);
    if (!this.data.maintainMileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    const amountStr = this.data.maintainAmount;
    const amountNum = amountStr ? Number(amountStr) : NaN;
    const amount = !amountStr || isNaN(amountNum) || amountNum <= 0 ? null : round2(amountNum);

    saveMaintainHandle(getStorage(), {
      carSourceId: this.data.carId,
      maintainSourceIds: selectedIds,
      makeDate: this.data.maintainDateValue,
      makeMileages: mileageNum,
      amount,
      remark: this.data.maintainRemark
    });
    this.done();
  },
  saveRepair() {
    if (!this.data.repairContent.trim()) {
      wx.showToast({ title: '请输入维修内容', icon: 'none' });
      return;
    }
    const mileageNum = Number(this.data.repairMileages);
    if (!this.data.repairMileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    const amountStr = this.data.repairAmount;
    const amountNum = amountStr ? Number(amountStr) : NaN;
    const amount = !amountStr || isNaN(amountNum) || amountNum <= 0 ? null : round2(amountNum);

    saveRepair(getStorage(), {
      carSourceId: this.data.carId,
      content: this.data.repairContent,
      mileage: mileageNum,
      repairDate: this.data.repairDateValue,
      amount,
      remark: this.data.repairRemark
    });
    this.done();
  },
  saveCost() {
    const cat = this.data.categories[this.data.selectedCategoryIndex];
    if (!cat) {
      wx.showToast({ title: '请选择支出类别', icon: 'none' });
      return;
    }
    const amountNum = Number(this.data.costAmount);
    if (!this.data.costAmount || isNaN(amountNum) || amountNum <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    saveCost(getStorage(), {
      carSourceId: this.data.carId,
      categorySourceId: cat.sourceId,
      amount: round2(amountNum),
      costDate: this.data.costDateValue,
      remark: this.data.costRemark
    });
    this.done();
  },
  done() {
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
