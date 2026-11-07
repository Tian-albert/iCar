// 保养提醒阈值设置（每辆车单独设置）
import { getStorage } from '../../store/index';
import { getMaintainThresholds, setMaintainThresholds } from '../../services/maintain-record.service';
import { getCar } from '../../services/car.service';

Page({
  data: {
    carId: '',
    mileage: '',
    days: ''
  },
  onLoad(options: Record<string, string>) {
    const carId = options.id;
    if (!carId || !getCar(getStorage(), carId)) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ carId });
    const t = getMaintainThresholds(getStorage(), carId);
    this.setData({ mileage: String(t.mileage), days: String(t.days) });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ mileage: e.detail.value });
  },
  onDaysInput(e: WechatMiniprogram.Input) {
    this.setData({ days: e.detail.value });
  },
  onSave() {
    const rawMileage = this.data.mileage.trim();
    const rawDays = this.data.days.trim();
    const mileage = Number(rawMileage);
    const days = Number(rawDays);
    // 空串 Number('') = 0，且阈值 0 会退化为「逾期才提醒」，必须拒绝
    if (!rawMileage || !isFinite(mileage) || mileage <= 0) {
      wx.showToast({ title: '请输入有效里程阈值', icon: 'none' });
      return;
    }
    if (!rawDays || !isFinite(days) || days <= 0) {
      wx.showToast({ title: '请输入有效天数阈值', icon: 'none' });
      return;
    }
    if (!this.data.carId) {
      wx.showToast({ title: '车辆信息无效', icon: 'none' });
      return;
    }
    setMaintainThresholds(getStorage(), this.data.carId, mileage, days);
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
