// 自定义底部栏：悬浮胶囊 + 液态毛玻璃
//
// 形态参考 iOS 的浮动工具栏：整条脱离屏幕底部，圆角胶囊，
// 四周有留白，背景用 backdrop-filter 模糊下层内容。
//
// 图标不用 emoji：emoji 是彩色字形，无法换色、无法做线性/实心双态，
// 基线在不同机型上也不一致。这里用手绘 SVG 的 base64 data URI
// （小程序 WXML 不支持内联 <svg>）。
//
// 滑动联动：三个 tab 在同一个宿主页里由 swiper 承载，页面滑动时
// 宿主页把「指示块该在哪」传进来（setIndicatorOffset）。
// **胶囊本身不动**，只有选中项的浅蓝底块跟着滑动——iOS Tab Bar 的观感。
import { TAB_ICONS_LINE, TAB_ICONS_FILL } from '../utils/tab-icons';

interface TabItem {
  pagePath: string;
  text: string;
  /** 图标键，对应 TAB_ICONS_* 的 key */
  icon: string;
}

Component({
  data: {
    selected: 0,
    list: [
      // 三个 tab 都在宿主页（pages/tab-host）里，由 swiper 承载，
      // 所以 pagePath 都指向宿主页；点击时通知宿主页切 swiper。
      { pagePath: '/pages/tab-host/index', text: '概览', icon: 'overview' },
      { pagePath: '/pages/tab-host/index', text: '车辆', icon: 'car' },
      { pagePath: '/pages/tab-host/index', text: '我的', icon: 'user' }
    ] as TabItem[],
    // WXML 里不能直接引用 import 的常量，必须经 data 传入
    lineIcons: TAB_ICONS_LINE,
    fillIcons: TAB_ICONS_FILL,
    /** 指示块的横向偏移（px），滑动时跟随 */
    indicatorOffset: 0,
    /** 指示块当前覆盖的 tab（用于高亮图标） */
    indicatorIndex: 0
  },
  methods: {
    /**
     * 点击底部栏某个 tab。
     *
     * 三个 tab 现在都在宿主页（pages/tab-host）里，由 swiper 承载，
     * 所以这里不是 wx.switchTab，而是通知宿主页把 swiper 滑过去。
     * 宿主页不存在时（异常兜底）退回 switchTab。
     */
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const path = e.currentTarget.dataset.path as string;
      if (typeof index !== 'number' || index < 0) return;

      const pages = getCurrentPages();
      const host = pages[pages.length - 1] as any;

      if (host && typeof host.switchToTab === 'function') {
        host.switchToTab(index);
        this.setData({ selected: index, indicatorIndex: index });
        return;
      }

      // 兜底：宿主页拿不到时走原生切页
      if (path) {
        wx.switchTab({ url: path });
        this.setData({ selected: index, indicatorIndex: index });
      }
    },

    /**
     * 宿主页调用：更新指示块位置与高亮项。
     *
     * 滑动过程中连续调用，指示块因此能跟手移动。
     */
    setIndicatorOffset(offset: number, index: number) {
      this.setData({ indicatorOffset: offset, indicatorIndex: index });
    }
  }
});
