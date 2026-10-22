// 自定义毛玻璃 TabBar
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/reminder/index', text: '保养', icon: '🔧' },
      { pagePath: '/pages/index/index', text: '车辆', icon: '🚙' },
      { pagePath: '/pages/user/index', text: '我的', icon: '👤' }
    ]
  },
  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.path as string;
      const index = Number(e.currentTarget.dataset.index);
      wx.switchTab({ url: path });
      this.setData({ selected: index });
    }
  }
});
