// 自定义毛玻璃 TabBar
Component({
  data: {
    selected: 0,
    list: [
      // 该页已由「保养」改为全局「概览」面板（保养提醒作为其中一个区块）
      { pagePath: '/pages/reminder/index', text: '概览', icon: '📊' },
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
