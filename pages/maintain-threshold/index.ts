// 保养提醒阈值设置（每辆车单独设置）
import { getStorage } from '../../store/index';
import { getMaintainThresholds, setMaintainThresholds } from '../../services/maintain-record.service';

Page({
  data: {
    carId: '',
    mileage: '',
    days: ''
  },
  onLoad(options: Record<string, string>) {
    this.setData({ carId: options.id || '' });
    const t = getMaintainThresholds(getStorage(), options.id);
    this.setData({ mileage: String(t.mileage), days: String(t.days) });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ mileage: e.detail.value });
  },
  onDaysInput(e: WechatMiniprogram.Input) {
    this.setData({ days: e.detail.value });
  },
  onSave() {
    const mileage = Number(this.data.mileage);
    const days = Number(this.data.days);
    if (isNaN(mileage) || mileage < 0) {
      wx.showToast({ title: '请输入有效里程阈值', icon: 'none' });
      return;
    }
    if (isNaN(days) || days < 0) {
      wx.showToast({ title: '请输入有效天数阈值', icon: 'none' });
      return;
    }
    setMaintainThresholds(getStorage(), this.data.carId, mileage, days);
    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
