// 页面侧：横向滑动手势 → 驱动底部栏胶囊位移 + 松手切换 tab
//
// 为什么不放在 tabBar 组件里：组件拿不到页面的触摸事件，
// 必须由页面识别手势后通过 getTabBar() 把进度传过去。
//
// 为什么不用 swiper：三个 tab 页各自是独立页面，swiper 方案要改成单页多 swiper，
// 改动面太大；且 swiper 无法让原生 tabBar 跟着滑动。这里用 touch 事件自己实现，
// 页面内容本身不动，只有底部胶囊跟手——正是 iOS Tab Bar 的观感。
import {
  SwipeState,
  Viewport,
  computeProgress,
  resolveTarget,
  stepPx,
  AXIS_RATIO,
  SWIPE_THRESHOLD_PX
} from './tab-swipe';

/**
 * 页面里可能用到的 tabBar 接口。
 *
 * 用宽松类型：真实实例是微信的 Page / Component 类型，
 * 这里只需要用到 setData 与两个自定义方法，做窄化反而容易对不上。
 */
interface TabBarLike {
  setData(data: any): void;
  setSwipeOffset?(progress: number, step: number, maxOffset: number): void;
  endSwipe?(offsetX: number): void;
}

/** 页面实例上需要用到的最小接口 */
type PageLike = any;

/** 三个 tab 页的配置 */
export interface TabSwipeConfig {
  /** 当前页在 tab 列表中的索引 */
  index: number;
  /** tab 总数 */
  count: number;
  /** 各 tab 的页面路径，顺序与 tab 栏一致 */
  paths: string[];
}

const TAB_PATHS = ['/pages/reminder/index', '/pages/index/index', '/pages/user/index'];

/** 页面内部保存手势状态的键 */
const STATE_KEY = '_tabSwipeState';

/** 页面内缓存 viewport（避免每次手势都同步查询） */
const VIEWPORT_KEY = '_tabSwipeViewport';

/** 取当前页面尺寸 */
function readViewport(page: PageLike): Viewport {
  const cached = (page as any)[VIEWPORT_KEY] as Viewport | undefined;
  if (cached) return cached;

  let vp: Viewport = { windowWidth: 375, windowHeight: 667 };
  try {
    const info = page.wx.getSystemInfoSync();
    vp = { windowWidth: info.windowWidth, windowHeight: info.windowHeight };
  } catch (e) {
    // 取不到就用默认值
  }
  (page as any)[VIEWPORT_KEY] = vp;
  return vp;
}

/** 拿到 tabBar 组件实例（可能为 undefined） */
function tabBarOf(page: PageLike): TabBarLike | undefined {
  if (typeof page.getTabBar !== 'function') return undefined;
  try {
    return page.getTabBar();
  } catch (e) {
    return undefined;
  }
}

/**
 * 给页面装上横滑手势。
 *
 * 返回的对象直接挂到 Page 的 touch 事件上：
 * ```ts
 * Page({ ...createTabSwipeHandlers({ index: 0, count: 3, paths: TAB_PATHS }) })
 * ```
 */
export function createTabSwipeHandlers(config: TabSwipeConfig) {
  return {
    onTouchStart(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches;
      if (!t || !t.length) return;
      const state: SwipeState = {
        startX: t[0].clientX,
        startY: t[0].clientY,
        horizontal: false,
        deltaX: 0
      };
      (this as any)[STATE_KEY] = state;
    },

    onTouchMove(e: WechatMiniprogram.TouchEvent) {
      const state = (this as any)[STATE_KEY] as SwipeState | undefined;
      const t = e.touches;
      if (!state || !t || !t.length) return;

      const dx = t[0].clientX - state.startX;
      const dy = t[0].clientY - state.startY;

      if (!state.horizontal) {
        // 还没判定方向：横向位移明显大于纵向才认为是横滑
        if (Math.abs(dx) < 6) return;
        if (Math.abs(dx) < Math.abs(dy) * AXIS_RATIO) {
          // 判定为纵向手势，放弃横滑
          (this as any)[STATE_KEY] = null;
          return;
        }
        state.horizontal = true;
      }

      state.deltaX = dx;

      const bar = tabBarOf(this);
      if (!bar || !bar.setSwipeOffset) return;

      const vp = readViewport(this);
      const progress = computeProgress(state, config.index, vp, config.count);
      const step = stepPx(vp, config.count);
      bar.setSwipeOffset(progress, step, step * 0.75);
    },

    onTouchEnd() {
      const state = (this as any)[STATE_KEY] as SwipeState | undefined;
      (this as any)[STATE_KEY] = null;
      if (!state || !state.horizontal) return;

      const bar = tabBarOf(this);
      const vp = readViewport(this);
      const { target, switched } = resolveTarget(state, config.index, vp, config.count);

      if (switched) {
        // 切到相邻 tab：胶囊先落到目标位置，再由新页面 onShow 复位
        const step = stepPx(vp, config.count);
        if (bar && bar.setSwipeOffset) {
          bar.setSwipeOffset(target, step, step * 0.75);
        }
        wx.switchTab({ url: config.paths[target] });
        return;
      }

      // 没切换：胶囊弹回原位
      if (bar && bar.endSwipe) bar.endSwipe(0);
    },

    onTouchCancel() {
      (this as any)[STATE_KEY] = null;
      const bar = tabBarOf(this);
      if (bar && bar.endSwipe) bar.endSwipe(0);
    }
  };
}

export { TAB_PATHS, SWIPE_THRESHOLD_PX };
