// 自定义底部栏：悬浮胶囊 + 液态毛玻璃
//
// 形态参考 iOS 的浮动工具栏：整条脱离屏幕底部，圆角胶囊，
// 四周有留白，背景用 backdrop-filter 模糊下层内容。
//
// 图标不用 emoji：emoji 是彩色字形，无法换色、无法做线性/实心双态，
// 基线在不同机型上也不一致。这里用手绘 SVG 的 base64 data URI
// （小程序 WXML 不支持内联 <svg>）。
//
// 滑动联动：页面横向滑动时通过 setTabBarOffset 把进度传进来，
// 胶囊跟着横向位移；松手后由页面决定切到哪个 tab。
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
      // 该页已由「保养」改为全局「概览」面板（保养提醒作为其中一个区块）
      { pagePath: '/pages/reminder/index', text: '概览', icon: 'overview' },
      { pagePath: '/pages/index/index', text: '车辆', icon: 'car' },
      { pagePath: '/pages/user/index', text: '我的', icon: 'user' }
    ] as TabItem[],
    // WXML 里不能直接引用 import 的常量，必须经 data 传入
    lineIcons: TAB_ICONS_LINE,
    fillIcons: TAB_ICONS_FILL,
    /** 胶囊横向位移（px），滑动时跟随手指 */
    offsetX: 0,
    /** 滑动中：禁用胶囊底的高亮切换，等松手后再定 */
    dragging: false
  },
  methods: {
    switchTab(e: WechatMiniprogram.TouchEvent) {
      const path = e.currentTarget.dataset.path as string;
      const index = Number(e.currentTarget.dataset.index);
      if (!path) return;
      wx.switchTab({ url: path });
      this.setData({ selected: index, offsetX: 0, dragging: false });
    },
    /**
     * 页面滑动时调用：更新胶囊位移。
     *
     * progress 是连续进度（0~2），本方法换算成像素位移。
     * 换算逻辑放在 utils/tab-swipe（页面与组件共用同一套步长定义）。
     */
    setSwipeOffset(progress: number, step: number, maxOffset: number) {
      const raw = (progress - this.data.selected) * step;
      const abs = Math.abs(raw);
      let diff = raw;
      if (abs > maxOffset) {
        // 超出部分做阻尼，且始终不超过 maxOffset 的 1.15 倍
        const capped = Math.min(maxOffset + (abs - maxOffset) * 0.25, maxOffset * 1.15);
        diff = raw > 0 ? capped : -capped;
      }
      this.setData({ offsetX: diff, dragging: true });
    },
    /** 页面松手：复位或落位 */
    endSwipe(offsetX: number) {
      this.setData({ offsetX, dragging: false });
    }
  }
});
