// 保养项目全量视图（名称 + 剩余量 + 进度条 + 周期），点击进入编辑
import { getStorage } from '../../store/index';
import {
  ensureMaintainTemplates,
  getMaintainProgress,
  formatCycle,
  removeMaintain
} from '../../services/maintain-record.service';
import { iconEmoji, isImageIcon } from '../../utils/icons';
import { getCar } from '../../services/car.service';

interface MaintainView {
  sourceId: string;
  name: string;
  icon: string;
  emoji: string;
  isImage: boolean;
  cycleText: string;
  remainText: string;
  progressPercent: number;
  urgent: boolean;
}

Page({
  data: {
    carId: '',
    maintains: [] as MaintainView[]
  },
  onLoad(options: Record<string, string>) {
    const carId = options.id;
    // 无效参数不得继续 seed，否则会生成 carSourceId='' 的幽灵保养项
    if (!carId || !getCar(getStorage(), carId)) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ carId });
  },
  onShow() {
    if (this.data.carId) this.load();
  },
  load() {
    const storage = getStorage();
    ensureMaintainTemplates(storage, this.data.carId);
    const progress = getMaintainProgress(storage, this.data.carId, Date.now());
    // 剩余比例升序：快到期的排前面
    const sorted = [...progress].sort((a, b) => a.progress - b.progress);
    const maintains = sorted.map(p => ({
      sourceId: p.maintain.sourceId,
      name: p.maintain.name,
      icon: p.maintain.icon,
      emoji: iconEmoji(p.maintain.icon),
      isImage: isImageIcon(p.maintain.icon),
      cycleText: formatCycle(p.maintain),
      remainText:
        p.remainDays !== null
          ? `剩余 ${p.remainDays} 天`
          : p.remainMileage !== null
            ? `剩余 ${p.remainMileage} km`
            : '',
      progressPercent: Math.round(p.progress * 100),
      urgent: p.urgent
    }));
    this.setData({ maintains });
  },
  onDelete(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.showModal({
      title: '删除保养项',
      content: '将同时移除该保养项的历史记录，可在「我的 → 回收站」中撤销（保留 30 天）。',
      confirmColor: '#F5474F',
      success: res => {
        if (!res.confirm) return;
        removeMaintain(getStorage(), id);
        wx.showToast({ title: '已删除', icon: 'none' });
        this.load();
      }
    });
  },
  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}&id=${id}` });
  },
  onAdd() {
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}` });
  }
});
