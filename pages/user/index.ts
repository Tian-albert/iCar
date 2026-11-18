// 用户中心 / 设置
//
// 不做登录：本页没有账号体系，只有本机设置与数据管理入口。
import { getStorage } from '../../store/index';
import { COMPONENT_ACTIVE_COLOR } from '../../utils/tokens';
import { getUser, setRemindEnabled } from '../../services/user.service';
import { FEEDBACK_EMAIL } from '../../utils/app-config';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';
import { clearAllData } from '../../services/clear-data.service';
import { SKIN_LABEL, SKIN_ORDER, applyChartTheme, applyPageSkin, getSkin, setSkin } from '../../utils/skin';
import { hasUnseenChangelog } from '../../services/changelog.service';

Page({
  data: {
    activeColor: COMPONENT_ACTIVE_COLOR,
    remindEnabled: true,
    skinName: SKIN_LABEL.a,
    /** 是否有用户没看过的更新日志版本（控制入口 NEW 小标） */
    changelogNew: false,
    feedbackEmail: FEEDBACK_EMAIL
  },
  onShow() {
    const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tab) {
      tab.setData({ selected: 2 });
      // 每个 tab 页各自持有一份底栏组件实例，切页时必须显式对齐皮肤
      if (typeof tab.refreshSkin === 'function') tab.refreshSkin();
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
      remindEnabled: user?.remindEnabled ?? true,
      skinName: SKIN_LABEL[getSkin()],
      changelogNew: hasUnseenChangelog(storage)
    });
  },
  onRemindChange(e: WechatMiniprogram.SwitchChange) {
    setRemindEnabled(getStorage(), e.detail.value);
    this.setData({ remindEnabled: e.detail.value });
  },
  /**
   * 切换皮肤。
   *
   * 选择后立刻把新令牌写进当前页面（不等下次 onShow），
   * 否则用户点完会看到「设置页没变」，误以为没生效。
   */
  onOpenSkin() {
    const current = getSkin();
    wx.showActionSheet({
      itemList: SKIN_ORDER.map(k => `${SKIN_LABEL[k]}${k === current ? ' ✓' : ''}`),
      success: res => {
        const skin = SKIN_ORDER[res.tapIndex];
        if (!skin || skin === current) return;
        setSkin(skin);
        applyChartTheme(skin);
        applyPageSkin(this);
        this.setData({ skinName: SKIN_LABEL[skin] });
        // 当前页的底栏也要立刻换，否则用户会看到「内容变了、底栏还是旧色」
        const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
        if (tab && typeof tab.refreshSkin === 'function') tab.refreshSkin();
      },
      fail: () => {
        // 用户取消，无需提示
      }
    });
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
  onOpenChangelog() {
    wx.navigateTo({ url: '/pages/changelog/index' });
  },
  onOpenFaq() {
    wx.navigateTo({ url: '/pages/faq/index' });
  },
  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },
  onFeedback() {
    wx.setClipboardData({
      data: this.data.feedbackEmail,
      success: () => wx.showToast({ title: '反馈邮箱已复制', icon: 'none' })
    });
  },

  /**
   * 清除所有数据。
   *
   * 不可撤销的破坏性操作，必须二次确认，且文案写清后果并引导先备份。
   */
  onClearAll() {
    wx.showModal({
      title: '清除所有数据？',
      content:
        '将删除本机的全部车辆、加油/充电、保养、维修、支出记录与自定义类别，包括回收站内容。\n\n此操作不可撤销。建议先到「数据导入导出」备份一份。',
      confirmText: '清除',
      confirmColor: '#F5474F',
      cancelText: '取消',
      success: res => {
        if (!res.confirm) return;
        this.doClearAll();
      }
    });
  },

  doClearAll() {
    wx.showLoading({ title: '正在清除', mask: true });

    const result = clearAllData(getStorage());
    wx.hideLoading();

    if (!result.ok) {
      wx.showModal({
        title: '清除未完成',
        content: result.message || '请重试',
        showCancel: false
      });
      return;
    }

    wx.showToast({ title: `已清除 ${result.removed} 条数据`, icon: 'none' });

    // 数据清空后本页已无意义，回到概览（会显示空态引导添加车辆）
    setTimeout(() => {
      wx.switchTab({ url: '/pages/reminder/index' });
    }, 600);
  }
});
