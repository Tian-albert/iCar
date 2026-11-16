// 用户中心
import { getStorage } from '../../store/index';
import { COMPONENT_ACTIVE_COLOR } from '../../utils/tokens';
import { getUser, setRemindEnabled } from '../../services/user.service';
import { FEEDBACK_EMAIL } from '../../utils/app-config';

Component({
  properties: {
    /** 本组件在 tab 列表中的索引（用于上报实例） */
    index: {
      type: Number,
      value: 2
    }
  },

  data: {
    activeColor: COMPONENT_ACTIVE_COLOR,
    nickname: '微信用户',
    remindEnabled: true,
    feedbackEmail: FEEDBACK_EMAIL
  },
  lifetimes: {
    attached() {
      (this as any).load();
    },
    ready() {
      // 把实例上报给父级（tab-swiper），父级切 tab 时据此调用 onShown 刷新
      this.triggerEvent('ready', { index: this.data.index, instance: this });
    }
  },

  methods: {
  /** 宿主页切到本组件时调用：刷新数据 */
  onShown() {
    this.load();
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
  }
});
