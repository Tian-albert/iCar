// 概览 Tab 薄壳页
//
// 三个 tab 各自是独立页面（tabBar.list 的 pagePath 不能重复），
// 但共享同一个 swiper 组件（components/tab-swiper），因此页面内容能真正横向滑动。

Page({
  data: {
    /** 初始停在第几个 tab（分享落地时可指定） */
    initial: 0
  },

  onLoad(options: Record<string, string>) {
    // 分享落地可指定 tab：?tab=1 落到「车辆」
    const raw = options && options.tab;
    const idx = parseInt(raw || '', 10);
    if (!isNaN(idx) && idx >= 0 && idx <= 2) {
      this.setData({ initial: idx });
    }
  },

  onShow() {
    // 从别的页面切回来时，让 swiper 刷新当前 tab 的内容
    const swiper = this.selectSwiper();
    if (swiper && typeof swiper.notifyCurrent === 'function') {
      swiper.notifyCurrent();
    }
  },

  /** 拿到 swiper 组件实例 */
  selectSwiper() {
    try {
      return (this as any).selectComponent?.('#tabSwiper');
    } catch (e) {
      return undefined;
    }
  },

  /**
   * 底部栏点击：让 swiper 滑到指定 tab。
   *
   * 不走 wx.switchTab —— 那会重建页面，内容会闪一下且失去滑动连贯性。
   */
  switchToTab(index: number) {
    const swiper = this.selectSwiper();
    if (swiper && typeof swiper.switchToTab === 'function') {
      swiper.switchToTab(index);
    }
  },

  /** swiper 上报的指示块位置：转给底部栏 */
  onIndicator(e: any) {
    const detail = e && e.detail;
    if (!detail) return;
    const bar = this.getTabBar?.();
    if (!bar) return;
    if (typeof (bar as any).setIndicatorOffset === 'function') {
      (bar as any).setIndicatorOffset(detail.offset, detail.index);
    } else {
      bar.setData({ indicatorOffset: detail.offset, indicatorIndex: detail.index });
    }
  }
});
