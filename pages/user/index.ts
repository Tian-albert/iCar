// 用户中心
import { getStorage } from '../../store/index';
import { COMPONENT_ACTIVE_COLOR } from '../../utils/tokens';
import { getUser, setRemindEnabled } from '../../services/user.service';
import { FEEDBACK_EMAIL } from '../../utils/app-config';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';
import { createTabSwipeHandlers, TAB_PATHS } from '../../utils/tab-swipe-page';

Page({
  data: {
    activeColor: COMPONENT_ACTIVE_COLOR,
    nickname: '微信用户',
    remindEnabled: true,
    feedbackEmail: FEEDBACK_EMAIL
  },
  // 横向滑动：底部栏胶囊跟手，松手切换相邻 tab
  ...createTabSwipeHandlers({ index: 2, count: 3, paths: TAB_PATHS }),
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      // 复位胶囊位移：从别处滑回来时不应停在半路
      this.getTabBar().setData({ selected: 2, offsetX: 0, dragging: false });
    }
    this.load();
    enableShareMenu();
  },
  onShareAppMessage() {
    return buildShareMessage();
  },
  onShareTimeline() {
    return buildTimelineMessage();
  },
  load() {
    const storage = getStorage();
    const user = getUser(storage);
    this.setData({
      nickname: user?.nickname || '微信用户',
      remindEnabled: user?.remindEnabled ?? true
    });
  },
  onRemindChange(e: WechatMiniprogram.SwitchChange) {
    setRemindEnabled(getStorage(), e.detail.value);
    this.setData({ remindEnabled: e.detail.value });
  },
  onOpenCategory() {
    wx.navigateTo({ url: '/pages/category-manage/index' });
  },
  onOpenDataTransfer() {
    wx.navigateTo({ url: '/pages/data-transfer/index' });
  },
  onOpenRecycleBin() {
    wx.navigateTo({ url: '/pages/recycle-bin/index' });
  },
  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },
  onFeedback() {
    wx.setClipboardData({
      data: this.data.feedbackEmail,
      success: () => wx.showToast({ title: '反馈邮箱已复制', icon: 'none' })
    });
  }
});
