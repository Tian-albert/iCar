// 新建 / 编辑保养项（名称 + 周期里程 + 时间周期[数值 | 单位 两滚轮]）
import { getStorage } from '../../store/index';
import { getMaintain, addMaintain, updateMaintainCycle, MaintainCycleForm } from '../../services/maintain-record.service';
import { getCar } from '../../services/car.service';
import { iconEmoji, isImageIcon } from '../../utils/icons';
import { COMPONENT_ACTIVE_COLOR } from '../../utils/tokens';
import { safeBack } from '../../utils/safe-back';
import { guardSave } from '../../utils/save-guard';

const MONTH_VALUES = Array.from({ length: 18 }, (_, i) => i + 1); // 月：1~18
const YEAR_VALUES = Array.from({ length: 10 }, (_, i) => i + 1); // 年：1~10
const UNIT_OPTIONS = ['月', '年'] as string[];

Page({
  data: {
    activeColor: COMPONENT_ACTIVE_COLOR,
    carId: '',
    id: '',
    name: '',
    cycleMileages: '',
    timeEnabled: true,
    timeUnits: UNIT_OPTIONS as string[],
    monthValues: MONTH_VALUES as number[],
    yearValues: YEAR_VALUES as number[],
    // 两列：第 0 列 = 数值，第 1 列 = 单位
    timeRange: [MONTH_VALUES, UNIT_OPTIONS] as (string | number)[][],
    timeValue: [0, 0] as number[], // [数值索引, 单位索引]
    timeText: '1月',
    // 默认给扳手图标：留空会让列表里显示成 📌，与「保养项」语义不符
    icon: '🔧',
    iconText: '🔧',
    isImage: false,
    pickerShow: false
  },
  onLoad(options: Record<string, string>) {
    const storage = getStorage();
    const carId = options.carId || '';
    // 新增时必须带合法 carId，否则会写入 carSourceId='' 的幽灵保养项
    // （其余 5 个表单都有这道兜底，本页之前漏了）
    if (!options.id && (!carId || !getCar(storage, carId))) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      safeBack(this);
      return;
    }
    this.setData({ carId });
    if (options.id) {
      const m = getMaintain(storage, options.id);
      if (m) {
        const months = m.cycleMonths;
        const useYear = months > 18 && months % 12 === 0;
        const unitIndex = useYear ? 1 : 0;
        const valueIndex = useYear ? months / 12 - 1 : months > 0 ? months - 1 : 0;
        const values = useYear ? YEAR_VALUES : MONTH_VALUES;
        const vi = Math.min(valueIndex, values.length - 1);
        this.setData({
          id: m.sourceId,
          name: m.name,
          cycleMileages: m.cycleMileages > 0 ? String(m.cycleMileages) : '',
          timeEnabled: months > 0,
          timeRange: [values, UNIT_OPTIONS],
          timeValue: [vi, unitIndex],
          timeText: `${values[vi]}${useYear ? '年' : '月'}`,
          // 旧数据显示 icon 为空时补 🔧，否则保存会把空值继续带下去
          icon: m.icon || '🔧',
          iconText: iconEmoji(m.icon || '🔧'),
          isImage: isImageIcon(m.icon || '')
        });
      }
    }
    wx.setNavigationBarTitle({ title: options.id ? '编辑保养项' : '添加保养项' });
  },
  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value });
  },
  onMileageInput(e: WechatMiniprogram.Input) {
    this.setData({ cycleMileages: e.detail.value });
  },
  onTimeEnabledChange(e: WechatMiniprogram.SwitchChange) {
    this.setData({ timeEnabled: e.detail.value });
    this.refreshTimeText();
  },
  onTimeColumnChange(e: WechatMiniprogram.PickerColumnChange) {
    const { column, value } = e.detail;
    if (column === 1) {
      // 单位列变化 → 更新数值列范围并归零
      const values = value === 0 ? MONTH_VALUES : YEAR_VALUES;
      this.setData({
        timeRange: [values, UNIT_OPTIONS],
        timeValue: [0, value]
      });
      this.refreshTimeText();
    }
  },
  onTimeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ timeValue: e.detail.value as number[] });
    this.refreshTimeText();
  },
  refreshTimeText() {
    if (!this.data.timeEnabled) return;
    const valueIndex = this.data.timeValue[0];
    const unitIndex = this.data.timeValue[1];
    const values = unitIndex === 0 ? MONTH_VALUES : YEAR_VALUES;
    const val = values[valueIndex] ?? values[0];
    const unit = unitIndex === 0 ? '月' : '年';
    this.setData({ timeText: `${val}${unit}` });
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
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }
    const cycleMileages = Number(this.data.cycleMileages) || 0;

    const valueIndex = this.data.timeValue[0];
    const unitIndex = this.data.timeValue[1];
    const values = unitIndex === 0 ? MONTH_VALUES : YEAR_VALUES;
    const timeValue = this.data.timeEnabled ? (values[valueIndex] ?? values[0]) : 0;
    const timeUnit = this.data.timeEnabled ? (unitIndex === 0 ? 'month' : 'year') : '';

    if (cycleMileages <= 0 && timeValue <= 0) {
      wx.showToast({ title: '至少设置里程或时间周期', icon: 'none' });
      return;
    }

    const form: MaintainCycleForm = { name: this.data.name, cycleMileages, timeUnit, timeValue, icon: this.data.icon };
    const storage = getStorage();

    // 进入页面时已校验过 carId；这里再兜一道，避免极端情况下写入空车
    if (!this.data.id && !this.data.carId) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      return;
    }

    // 防重复提交：连点两次只写一条（其余 5 个表单都走这个，本页之前漏了）
    const ok = guardSave(() => {
      if (this.data.id) {
        updateMaintainCycle(storage, this.data.id, form);
      } else {
        addMaintain(storage, this.data.carId, form);
      }
    });
    // 被节流或保存抛错时不提示成功、也不返回
    if (!ok) return;

    wx.showToast({ title: '已保存', icon: 'success' });
    safeBack(this);
  }
});
