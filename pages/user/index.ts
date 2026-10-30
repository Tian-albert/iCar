// 用户中心
import { getStorage } from '../../store/index';
import { getUser, setRemindEnabled } from '../../services/user.service';

Page({
  data: {
    nickname: '微信用户',
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
  onOpenAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },
  onComing() {
    wx.showToast({ title: '开发中', icon: 'none' });
  }
});
