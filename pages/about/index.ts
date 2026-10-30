// 关于页：展示主体资质（备案编号）并提供工信部备案查询入口
Page({
  data: {
    version: '1.0.2',
    // TODO: 备案通过后，替换为工信部核发的实际备案号，例如「粤ICP备2026xxxxxx号-2X」
    icp: '粤ICP备2026165445号-1X',
    beianUrl: 'http://beian.miit.gov.cn'
  },
  onCopyBeianUrl() {
    wx.setClipboardData({
      data: this.data.beianUrl,
      success: () => wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' })
    });
  },
  onOpenPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index' });
  }
});
