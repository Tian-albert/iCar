// 记一笔支出（支持新建 / 编辑）
import { getStorage } from '../../store/index';
import { saveCost, updateCost, listSpendCategories } from '../../services/cost.service';
import { getCar } from '../../services/car.service';
import { iconEmoji } from '../../utils/icons';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';
import { Cost } from '../../types/models';

interface CategoryView {
  sourceId: string;
  name: string;
  emoji: string;
  isPreset: boolean;
}

Page({
  data: {
    carId: '',
    recordId: '',
    categories: [] as CategoryView[],
    selectedIndex: -1,
    amount: '',
    dateText: formatDate(Date.now()),
    dateValue: Date.now(),
    remark: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const car = getCar(storage, options.carId);
    if (!car) return;

    const patch: Record<string, any> = { carId: car.sourceId };
    if (options.recordId) {
      const cost = storage.get<Cost>('costs', options.recordId);
      if (cost && !cost.deleted) {
        patch.recordId = cost.sourceId;
        patch.amount = String(cost.amount);
        patch.dateText = formatDate(cost.costDate);
        patch.dateValue = cost.costDate;
        patch.remark = cost.remark;
      }
    }
    this.setData(patch);
    this.loadCategories(options.recordId);
    wx.setNavigationBarTitle({ title: options.recordId ? '编辑支出' : '记支出' });
  },
  onShow() {
    if (this.data.carId && !this.data.recordId) this.loadCategories();
  },
  onManageCategory() {
    wx.navigateTo({ url: '/pages/category-manage/index' });
  },
  loadCategories(recordId?: string) {
    const storage = getStorage();
    const cats = listSpendCategories(storage).map(c => ({
      sourceId: c.sourceId,
      name: c.name,
      emoji: iconEmoji(c.icon),
      isPreset: c.isPreset
    }));
    let sel = this.data.selectedIndex;
    // 编辑：按原类别定位选中项
    if (recordId) {
      const cost = storage.get<Cost>('costs', recordId);
      const idx = cost ? cats.findIndex(c => c.sourceId === cost.categorySourceId) : -1;
      sel = idx >= 0 ? idx : 0;
    }
    if (sel < 0 && cats.length) sel = 0;
    this.setData({ categories: cats, selectedIndex: sel });
  },
  onSelectCategory(e: WechatMiniprogram.TouchEvent) {
    this.setData({ selectedIndex: Number(e.currentTarget.dataset.index) });
  },
  onAmountInput(e: WechatMiniprogram.Input) {
    this.setData({ amount: e.detail.value });
  },
  onDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ dateText: text, dateValue: new Date(y, m - 1, d).getTime() });
  },
  onRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value });
  },
  onSave() {
    const cat = this.data.categories[this.data.selectedIndex];
    if (!cat) {
      wx.showToast({ title: '请选择类别', icon: 'none' });
      return;
    }
    const amountNum = Number(this.data.amount);
    if (!this.data.amount || isNaN(amountNum) || amountNum <= 0) {
      wx.showToast({ title: '请输入金额', icon: 'none' });
      return;
    }
    const form = {
      carSourceId: this.data.carId,
      categorySourceId: cat.sourceId,
      amount: round2(amountNum),
      costDate: this.data.dateValue,
      remark: this.data.remark
    };
    const storage = getStorage();
    if (this.data.recordId) {
      updateCost(storage, this.data.recordId, form);
    } else {
      saveCost(storage, form);
    }
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
