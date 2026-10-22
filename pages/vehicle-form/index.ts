// 新建车辆
import { getStorage } from '../../store/index';
import { createCar } from '../../services/car.service';
import { formatDate } from '../../utils/date';
import { iconEmoji, isImageIcon } from '../../utils/icons';
import { EnergyType } from '../../types/models';

const ENERGY_OPTIONS: Array<{ label: string; value: EnergyType }> = [
  { label: '燃油', value: 'fuel' },
  { label: '纯电', value: 'ev' },
  { label: '混动', value: 'hybrid' }
];

Page({
  data: {
    name: '',
    mileages: '',
    initDate: Date.now(),
    initDateText: formatDate(Date.now()),
    energyIndex: 0,
    energyLabels: ENERGY_OPTIONS.map(o => o.label),
    icon: 'car',
    iconText: '🚗',
    isImage: false,
    pickerShow: false
  },
  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ mileages: e.detail.value });
  },
  onDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({
      initDateText: text,
      initDate: new Date(y, m - 1, d).getTime()
    });
  },
  onEnergyChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ energyIndex: Number(e.detail.value) });
  },
  onPickIcon() {
    this.setData({ pickerShow: true });
  },
  onIconSelect(e: WechatMiniprogram.CustomEvent) {
    const icon = e.detail.icon as string;
    this.setData({ icon, iconText: iconEmoji(icon), isImage: isImageIcon(icon), pickerShow: false });
  },
  onPickerClose() {
    this.setData({ pickerShow: false });
  },
  onSave() {
    const { name, mileages, initDate, energyIndex } = this.data;
    if (!name.trim()) {
      wx.showToast({ title: '请输入车辆名称', icon: 'none' });
      return;
    }
    const mileageNum = Number(mileages);
    if (!mileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    const energyType = ENERGY_OPTIONS[energyIndex].value;
    const storage = getStorage();
    createCar(storage, { name, mileages: mileageNum, initDate, energyType, icon: this.data.icon });
    wx.showToast({ title: '已添加', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
