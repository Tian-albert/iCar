// Tab 宿主页：把三个 tab 合并到一个页面里，用 swiper 实现真正的横向滑动。
//
// 为什么必须有宿主页：
// `wx.switchTab` 切的是**独立页面**，切过去必然重新 onLoad → 重新渲染，
// 页面内容不可能横向平移。要让内容真正跟手滑动，三个 tab 必须在同一个页面内，
// 由 swiper 承载。
//
// 与底部栏的联动：
// - swiper 的 `transition` 事件给出 dx（swiper-item 位移，正为右滑、负为左滑）
// - 用 dx 算出底部栏指示块该在哪，经 getTabBar() 传过去
// - 指示块连续移动，跟手；高亮图标取最近的那个 tab
//
// 底部栏胶囊本身不动——只有选中项的浅蓝底块滑动。
import { indicatorOffset, indicatorActiveIndex } from '../../utils/tab-indicator';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';

Page({
  data: {
    /** swiper 当前项 */
    current: 0,
    /**
     * 当前「已激活」的 tab。
     * 用它决定渲染哪个内容组件：非激活的不渲染，省内存也避免 canvas 抢节点。
     */
    active: 0,
    /** 每个 tab 的步长（px），由 onReady 实测得到 */
    step: 0
  },

  onLoad(options: Record<string, string>) {
    enableShareMenu();

    // 分享落地可指定 tab：?tab=1 落到「车辆」
    const raw = options && options.tab;
    const idx = parseInt(raw || '', 10);
    if (!isNaN(idx) && idx >= 0 && idx <= 2) {
      this.setData({ current: idx, active: idx });
    }
  },

  onReady() {
    this.measureStep();
    this.syncTabBar(0, 0);
  },

  /**
   * 实测每个 tab 的步长（px）。
   *
   * 底部栏指示块要跟 swiper 精确对齐，步长必须与实际渲染一致，
   * 所以用 SelectorQuery 量，而不是写死换算公式。
   *
   * 宿主页宽度就是屏幕宽度，底部栏胶囊左右各留 28rpx、内部左右各 8rpx，
   * 指示块宽度 = (屏宽 - 2*28rpx - 2*8rpx) / 3。
   */
  measureStep() {
    this.createSelectorQuery()
      .select('#tabHostRoot')
      .boundingClientRect((rect: any) => {
        const w = rect && rect.width;
        if (!(w > 0)) return;
        const rpx = w / 750;
        const inner = w - 28 * 2 * rpx - 8 * 2 * rpx;
        this.setData({ step: inner / 3 });
        // 步长拿到后重新同步一次指示块
        this.syncTabBar(0, this.data.current);
      })
      .exec();
  },

  /** 把指示块位置与高亮项同步给底部栏 */
  syncTabBar(dx: number, current: number) {
    const bar = this.getTabBar?.();
    if (!bar) return;
    const step = this.data.step;
    if (!(step > 0)) return;

    const offset = indicatorOffset(dx, current, 3, step);
    const activeIndex = indicatorActiveIndex(dx, current, 3, step);

    if (typeof (bar as any).setIndicatorOffset === 'function') {
      (bar as any).setIndicatorOffset(offset, activeIndex);
    } else {
      bar.setData({ indicatorOffset: offset, indicatorIndex: activeIndex });
    }
  },

  /**
   * 底部栏点击：把 swiper 滑到指定 tab。
   *
   * 底部栏是自定义组件，它拿不到宿主页的实例，所以由宿主页暴露这个方法，
   * 底栏通过 getCurrentPages() 找到最后一页（即宿主页）后调用。
   */
  switchToTab(index: number) {
    const target = Math.min(2, Math.max(0, index));
    if (target === this.data.current) {
      // 已在该 tab：直接让指示块归位，避免点击后底块不跟手
      this.syncTabBar(0, target);
      return;
    }
    this.setData({ current: target, active: target });
    this.syncTabBar(0, target);
    this.notifyShown(target);
  },

  /** swiper 切换完成：更新 current / active，并通知内容组件刷新 */
  onSwiperChange(e: any) {
    const current = e.detail && e.detail.current;
    if (typeof current !== 'number') return;
    this.setData({ current, active: current });
    this.syncTabBar(0, current);
    this.notifyShown(current);
  },

  /** 通知当前 tab 的内容组件刷新数据（组件没有 onShow） */
  notifyShown(index: number) {
    const ids = ['#tabOverview', '#tabVehicles', '#tabProfile'];
    const id = ids[index];
    if (!id) return;

    // 用 selectComponent 而不是 createSelectorQuery().select().node()：
    // 后者对自定义组件节点在真机上取不到实例方法。
    const comp = (this as any).selectComponent?.(id);
    if (comp && typeof comp.onShown === 'function') {
      comp.onShown();
    }
  },

  /** 滑动过程中：指示块跟手 */
  onSwiperTransition(e: any) {
    const dx = (e.detail && e.detail.dx) || 0;
    this.syncTabBar(dx, this.data.current);
  },

  /** 动画结束：指示块精确落到目标 tab */
  onSwiperAnimationFinish(e: any) {
    const current = e.detail && e.detail.current;
    if (typeof current !== 'number') return;
    this.syncTabBar(0, current);
  },

  onShareAppMessage() {
    return buildShareMessage({ highlight: this.currentHighlight() });
  },

  onShareTimeline() {
    return buildTimelineMessage({ highlight: this.currentHighlight() });
  },

  /** 取当前 tab 内容组件的分享文案 */
  currentHighlight(): string {
    const ids = ['#tabOverview', '#tabVehicles', '#tabProfile'];
    const id = ids[this.data.current];
    if (!id) return '';

    const comp = (this as any).selectComponent?.(id);
    if (comp && typeof comp.getShareHighlight === 'function') {
      return comp.getShareHighlight() || '';
    }
    return '';
  }
});
