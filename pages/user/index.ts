// 用户中心
import { getStorage } from '../../store/index';
import { getUser, getMemberView, setRemindEnabled } from '../../services/user.service';

Page({
  data: {
    nickname: '微信用户',
    isPro: false,
    expireText: '',
    remindEnabled: true
  },
  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    this.load();
  },
  load() {
    const storage = getStorage();
    const user = getUser(storage);
    const member = getMemberView(storage);
    this.setData({
      nickname: user?.nickname || '微信用户',
      isPro: member.level === 'pro',
      expireText: member.expireText,
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
  onUpgrade() {
    wx.showToast({ title: '会员功能开发中', icon: 'none' });
  },
  onComing() {
    wx.showToast({ title: '开发中', icon: 'none' });
  }
});
