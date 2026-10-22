// 记一笔维修（支持新建 / 编辑）
import { getStorage } from '../../store/index';
import { saveRepair, updateRepair } from '../../services/repair.service';
import { getCar } from '../../services/car.service';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';
import { RepairRecord } from '../../types/models';

Page({
  data: {
    carId: '',
    recordId: '',
    content: '',
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
    const patch: Record<string, any> = { carId: car.sourceId, mileages: String(car.mileages) };
    if (options.recordId) {
      const r = storage.get<RepairRecord>('repairRecords', options.recordId);
      if (r && !r.deleted) {
        patch.recordId = r.sourceId;
        patch.content = r.content;
        patch.mileages = String(r.mileage);
        patch.dateText = formatDate(r.repairDate);
        patch.dateValue = r.repairDate;
        patch.amount = r.amount > 0 ? String(r.amount) : '';
        patch.remark = r.remark;
      }
    }
    this.setData(patch);
    wx.setNavigationBarTitle({ title: options.recordId ? '编辑维修' : '记维修' });
  },
  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value });
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
    if (!this.data.content.trim()) {
      wx.showToast({ title: '请输入维修内容', icon: 'none' });
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
      content: this.data.content,
      mileage: mileageNum,
      repairDate: this.data.dateValue,
      amount,
      remark: this.data.remark
    };
    const storage = getStorage();
    if (this.data.recordId) {
      updateRepair(storage, this.data.recordId, form);
    } else {
      saveRepair(storage, form);
    }

    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
