// 记一笔支出（支持新建 / 编辑）
import { getStorage } from '../../store/index';
import { guardSave } from '../../utils/save-guard';
import {
  saveCost,
  updateCost,
  listCategories,
  listSpendCategories,
  resolveCategorySelection,
  getCategory
} from '../../services/cost.service';
import { getCar } from '../../services/car.service';
import { displayIcon, isImageIcon } from '../../utils/icons';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';
import { Cost } from '../../types/models';
import { safeBack } from '../../utils/safe-back';

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
    originalCategoryId: '',
    categoryLocked: false,
    amount: '',
    dateText: formatDate(Date.now()),
    dateValue: Date.now(),
    remark: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const car = getCar(storage, options.carId);
    if (!car) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      safeBack(this);
      return;
    }

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
    // 一律只给「支出类别」。编辑态若放开全量，用户能把手工支出改成
    // 加油/充电/保养/维修 —— 这四个由专用表单生成流水，改成它们等于同一笔消费记两遍。
    const base = listSpendCategories(storage);
    let source = base;

    let originalCategoryId = this.data.originalCategoryId;
    if (recordId) {
      const cost = storage.get<Cost>('costs', recordId);
      originalCategoryId = cost?.categorySourceId ?? '';
      // 原类别可能已隐藏、或本身就是系统预设（历史数据）：必须补进候选，
      // 否则 resolveCategorySelection 会判为「原类别已不可用」而锁死选择。
      if (
        originalCategoryId &&
        !base.some(c => c.sourceId === originalCategoryId)
      ) {
        const original = getCategory(storage, originalCategoryId);
        if (original) source = base.concat([original]);
      }
    }

    const cats = source.map(c => ({
      sourceId: c.sourceId,
      name: c.name,
      emoji: displayIcon(c.icon),
      // 自定义图片图标必须走 <image>，否则会把 wxfile:// 路径当文字渲染
      icon: c.icon || '',
      isImage: isImageIcon(c.icon || ''),
      isPreset: c.isPreset
    }));
    const result = resolveCategorySelection(cats, originalCategoryId, !!recordId);
    this.setData({
      categories: cats,
      selectedIndex: result.selectedIndex,
      originalCategoryId,
      categoryLocked: result.locked
    });
  },
  onSelectCategory(e: WechatMiniprogram.TouchEvent) {
    if (this.data.categoryLocked) {
      wx.showToast({ title: '原类别已不可用，保存将保留原类别', icon: 'none' });
      return;
    }
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
    if (!this.data.carId) {
      wx.showToast({ title: '车辆信息无效', icon: 'none' });
      return;
    }
    const cat = this.data.categories[this.data.selectedIndex];
    // 锁定态（原类别已软删/异常）保留原 categorySourceId，绝不回退到第一项
    const categorySourceId =
      cat?.sourceId || (this.data.recordId ? this.data.originalCategoryId : '');
    if (!categorySourceId) {
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
      categorySourceId,
      amount: round2(amountNum),
      costDate: this.data.dateValue,
      remark: this.data.remark
    };
    const storage = getStorage();
    const ok = guardSave(() => {
      if (this.data.recordId) {
        updateCost(storage, this.data.recordId, form);
      } else {
        saveCost(storage, form);
      }
    });
    if (!ok) return;
    wx.showToast({ title: '已保存', icon: 'success' });
    safeBack(this);
  }
});
