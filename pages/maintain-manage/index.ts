// 保养项目全量视图（名称 + 剩余量 + 进度条 + 周期），点击进入编辑
import { getStorage } from '../../store/index';
import { ensureMaintainTemplates, getMaintainProgress, formatCycle } from '../../services/maintain-record.service';
import { iconEmoji, isImageIcon } from '../../utils/icons';

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
    this.setData({ carId: options.id });
  },
  onShow() {
    this.load();
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
  onEdit(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}&id=${id}` });
  },
  onAdd() {
    wx.navigateTo({ url: `/pages/maintain-item-form/index?carId=${this.data.carId}` });
  }
});
