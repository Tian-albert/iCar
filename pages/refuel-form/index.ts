// 记一笔加油（支持新建 / 编辑）
import { getStorage } from '../../store/index';
import { saveRefuel, updateRefuel } from '../../services/refuel.service';
import { getCar } from '../../services/car.service';
import { formatDate } from '../../utils/date';
import { round2 } from '../../utils/number';
import { RefuelLog } from '../../types/models';

Page({
  data: {
    carId: '',
    recordId: '',
    carName: '',
    dateText: formatDate(Date.now()),
    dateValue: Date.now(),
    originalFuelDate: 0,
    mileages: '',
    unitPrice: '',
    volume: '',
    shouldPayText: '0.00',
    actual: '',
    actualTouched: false,
    fullIndex: 0,
    fullOptions: ['加满', '没加满'],
    lowIndex: 1,
    lowOptions: ['低', '不低'],
    lastIndex: 0,
    lastOptions: ['记了', '没记'],
    remark: ''
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const car = getCar(storage, options.carId);
    if (!car) return;
    const patch: Record<string, any> = {
      carId: car.sourceId,
      carName: car.name,
      mileages: String(car.mileages)
    };
    if (options.recordId) {
      const log = storage.get<RefuelLog>('fuelRecords', options.recordId);
      if (log && !log.deleted) {
        patch.recordId = log.sourceId;
        patch.dateText = formatDate(log.fuelDate);
        patch.dateValue = log.fuelDate;
        patch.originalFuelDate = log.fuelDate;
        patch.mileages = String(log.makeMileages);
        patch.unitPrice = String(log.unitPrice);
        patch.volume = String(log.volume);
        patch.shouldPayText = log.shouldPayAmount.toFixed(2);
        patch.actual = log.actualPayAmount.toFixed(2);
        patch.actualTouched = true;
        patch.fullIndex = log.isFull ? 0 : 1;
        patch.lowIndex = log.isLowFuel ? 0 : 1;
        patch.lastIndex = log.lastRecorded ? 0 : 1;
        patch.remark = log.remark;
      }
    }
    this.setData(patch);
    wx.setNavigationBarTitle({ title: options.recordId ? '编辑加油' : '记加油' });
  },
  onDateChange(e: WechatMiniprogram.PickerChange) {
    const text = e.detail.value as string;
    const [y, m, d] = text.split('-').map(Number);
    this.setData({ dateText: text, dateValue: new Date(y, m - 1, d).getTime() });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ mileages: e.detail.value });
  },
  onUnitPriceInput(e: WechatMiniprogram.Input) {
    this.setData({ unitPrice: e.detail.value });
    this.recalc();
  },
  onVolumeInput(e: WechatMiniprogram.Input) {
    this.setData({ volume: e.detail.value });
    this.recalc();
  },
  onActualInput(e: WechatMiniprogram.Input) {
    this.setData({ actual: e.detail.value, actualTouched: true });
  },
  recalc() {
    const up = Number(this.data.unitPrice || 0);
    const vol = Number(this.data.volume || 0);
    const shouldPay = round2(up * vol);
    const patch: Record<string, string | boolean> = { shouldPayText: shouldPay.toFixed(2) };
    if (!this.data.actualTouched) patch.actual = shouldPay.toFixed(2);
    this.setData(patch);
  },
  onFullChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ fullIndex: Number(e.detail.value) });
  },
  onLowChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ lowIndex: Number(e.detail.value) });
  },
  onLastChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ lastIndex: Number(e.detail.value) });
  },
  onRemarkInput(e: WechatMiniprogram.Input) {
    this.setData({ remark: e.detail.value });
  },
  onSave() {
    const { carId, mileages, unitPrice, volume, actual } = this.data;
    const mileageNum = Number(mileages);
    const priceNum = Number(unitPrice);
    const volumeNum = Number(volume);
    const actualNum = Number(actual);

    if (!mileages || isNaN(mileageNum) || mileageNum < 0) {
      wx.showToast({ title: '请输入有效里程', icon: 'none' });
      return;
    }
    if (!unitPrice || isNaN(priceNum) || priceNum <= 0) {
      wx.showToast({ title: '请输入单价', icon: 'none' });
      return;
    }
    if (!volume || isNaN(volumeNum) || volumeNum <= 0) {
      wx.showToast({ title: '请输入加油量', icon: 'none' });
      return;
    }

    // 编辑时保留原记录时分，新建用当前时分
    const base = this.data.recordId ? new Date(this.data.originalFuelDate) : new Date();
    const d = new Date(this.data.dateValue);
    const fuelDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes()).getTime();

    const form = {
      carSourceId: carId,
      fuelDate,
      makeMileages: mileageNum,
      unitPrice: priceNum,
      volume: volumeNum,
      actualPayAmount: isNaN(actualNum) ? null : actualNum,
      isFull: this.data.fullIndex === 0,
      isLowFuel: this.data.lowIndex === 0,
      lastRecorded: this.data.lastIndex === 0,
      remark: this.data.remark
    };

    const storage = getStorage();
    if (this.data.recordId) {
      updateRefuel(storage, this.data.recordId, form);
    } else {
      saveRefuel(storage, form);
    }

    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 600);
  }
});
