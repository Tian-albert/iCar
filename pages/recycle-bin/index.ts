// 回收站：30 天内可整批撤销删除（R-03）
import { getStorage } from '../../store/index';
import {
  listRecycleBatches,
  restoreBatch,
  purgeExpired,
  RETENTION_DAYS,
  RecycleBatch
} from '../../services/recycle.service';
import { formatDateTime } from '../../utils/date';

interface BatchView extends RecycleBatch {
  dateText: string;
  remainText: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

Page({
  data: {
    items: [] as BatchView[],
    retentionDays: RETENTION_DAYS
  },
  onShow() {
    this.load();
  },
  load() {
    const now = Date.now();
    const items = listRecycleBatches(getStorage()).map(b => {
      const remain = Math.max(0, Math.ceil((b.deletedAt + RETENTION_DAYS * DAY_MS - now) / DAY_MS));
      return {
        ...b,
        dateText: formatDateTime(b.deletedAt),
        remainText: `剩余 ${remain} 天`
      };
    });
    this.setData({ items });
  },
  onRestore(e: WechatMiniprogram.TouchEvent) {
    const batch = e.currentTarget.dataset.batch as string;
    wx.showModal({
      title: '恢复记录',
      content: '将恢复该批次的全部记录及关联数据，确定吗？',
      confirmColor: '#3B6FF6',
      success: res => {
        if (!res.confirm) return;
        const ok = restoreBatch(getStorage(), batch);
        wx.showToast({ title: ok ? '已恢复' : '记录已不存在', icon: ok ? 'success' : 'none' });
        this.load();
      }
    });
  },
  onPurge() {
    const n = purgeExpired(getStorage());
    wx.showToast({ title: n ? `已清理 ${n} 条过期记录` : '暂无过期记录', icon: 'none' });
    this.load();
  }
});
