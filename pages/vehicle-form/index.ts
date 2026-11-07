// 车辆表单（新建 / 编辑；首版仅支持燃油车）
import { getStorage } from '../../store/index';
import { guardSave } from '../../utils/save-guard';
import { createCar, updateCar, getCar } from '../../services/car.service';
import { formatDate } from '../../utils/date';
import { iconEmoji, isImageIcon } from '../../utils/icons';
import { Car } from '../../types/models';
import { deleteCarCascade } from '../../services/recycle.service';

Page({
  data: {
    carId: '',
    isEdit: false,
    name: '',
    mileages: '',
    mileageLabel: '当前里程 (km)',
    initDate: Date.now(),
    initDateText: formatDate(Date.now()),
    icon: 'car',
    iconText: '🚗',
    isImage: false,
    pickerShow: false
  },
  onLoad(options: Record<string, string>) {
    if (!options.id) {
      wx.setNavigationBarTitle({ title: '添加车辆' });
      return;
    }
    const car = getCar(getStorage(), options.id);
    if (!car) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      return;
    }
    this.fillForm(car);
    wx.setNavigationBarTitle({ title: '编辑车辆' });
  },
  fillForm(car: Car) {
    const icon = car.icon || 'car';
    this.setData({
      carId: car.sourceId,
      isEdit: true,
      name: car.name,
      // 编辑态可改的是「初始里程」（保养基线）；当前里程由加油记录自动回写
      mileages: String(car.initMileages ?? 0),
      mileageLabel: '初始里程 (km)',
      initDate: car.initDate,
      initDateText: formatDate(car.initDate),
      icon,
      iconText: iconEmoji(icon),
      isImage: isImageIcon(icon)
    });
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
    const { name, mileages, initDate, icon, isEdit, carId } = this.data;
    if (!name.trim()) {
      wx.showToast({ title: '请输入车辆名称', icon: 'none' });
      return;
    }
    const mileageNum = Number(mileages);
    if (!mileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    const storage = getStorage();
    const ok = guardSave(() => {
      if (isEdit) {
        const updated = updateCar(storage, carId, {
          name,
          initMileages: mileageNum,
          initDate,
          icon
        });
        if (!updated) throw new Error('车辆不存在');
      } else {
        createCar(storage, {
          name,
          mileages: mileageNum,
          initDate,
          energyType: 'fuel',
          icon
        });
      }
    });
    if (!ok) return;
    wx.showToast({ title: isEdit ? '已保存' : '已添加', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  },
  /** 删除车辆：连带名下全部记录，30 天内可在回收站整批撤销 */
  onDeleteCar() {
    wx.showModal({
      title: '删除车辆',
      content: '将同时删除该车名下的全部记录，可在「我的 → 回收站」中撤销（保留 30 天）。确定删除吗？',
      confirmColor: '#F5474F',
      success: res => {
        if (!res.confirm) return;
        if (!deleteCarCascade(getStorage(), this.data.carId)) {
          wx.showToast({ title: '车辆不存在', icon: 'none' });
          return;
        }
        wx.showToast({ title: '已删除', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      }
    });
  }
});
