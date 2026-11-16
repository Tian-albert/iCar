// 底部栏随页面横向滑动而滑动
//
// 交互参考 iOS Tab Bar：页面左右滑动切换 tab 时，胶囊会跟着手指横向位移，
// 滑动到位后停在新位置。
//
// 实现要点：
// - 胶囊的横向位移由**页面**计算后传给 tabBar（tabBar 是独立组件，
//   拿不到页面的手势事件）
// - 页面用 touchstart/touchmove/touchend 自己做横向手势识别；
//   纵向滚动优先，所以只有当横向位移明显大于纵向位移时才判定为横滑
// - 滑动过程中**不真的切换页面**，松手时按位移方向决定目标 tab
//
// 位移换算：胶囊总宽 = 屏幕宽 - 左右各 28rpx；每个 tab 的「步长」
// = 胶囊内可用宽 / 3。progress 是连续值（0~2），表示从当前 tab 滑到了哪。

/** 胶囊左右外边距（rpx），与 custom-tab-bar/index.wxss 保持一致 */
export const TAB_MARGIN_RPX = 28;

/** 胶囊高度（rpx） */
export const TAB_HEIGHT_RPX = 108;

/** 判定为「横向滑动」的最小位移（px） */
export const SWIPE_THRESHOLD_PX = 40;

/** 纵向位移超过这个比例就不算横滑（避免和页面滚动打架） */
export const AXIS_RATIO = 1.2;

/** 手势状态 */
export interface SwipeState {
  startX: number;
  startY: number;
  /** 是否已判定为横向手势 */
  horizontal: boolean;
  /** 本次手势累计的横向位移 */
  deltaX: number;
}

/** 页面尺寸信息，用于把 rpx 换算成 px */
export interface Viewport {
  windowWidth: number;
  windowHeight: number;
}

/**
 * 横向滑动的连续进度。
 *
 * progress = 当前 tab 索引 + 拖动比例（-1 ~ +1），例如：
 * - 0.3：从第 1 个往第 2 个拖了 30%
 * - -0.5：从第 1 个往第 0 个拖了一半
 *
 * 超出 [0, tabCount-1] 的部分由调用方决定是否做边界回弹。
 */
export function computeProgress(
  state: SwipeState,
  currentIndex: number,
  viewport: Viewport,
  tabCount: number
): number {
  if (!state.horizontal) return currentIndex;
  const step = stepPx(viewport, tabCount);
  if (!(step > 0)) return currentIndex;

  const raw = currentIndex + state.deltaX / step;
  // 允许略微越界用于回弹，但不超过一个 tab 的距离
  const min = -0.35;
  const max = tabCount - 1 + 0.35;
  return Math.min(max, Math.max(min, raw));
}

/** 每个 tab 之间的横向步长（px） */
export function stepPx(viewport: Viewport, tabCount: number): number {
  if (!(viewport.windowWidth > 0) || tabCount <= 0) return 0;
  const rpxRatio = viewport.windowWidth / 750;
  const capsuleWidth = viewport.windowWidth - TAB_MARGIN_RPX * 2 * rpxRatio;
  // 胶囊内左右各 8rpx 内边距
  const inner = capsuleWidth - 8 * 2 * rpxRatio;
  return inner / tabCount;
}

/**
 * 判断松手后应该去哪个 tab。
 *
 * 规则：位移超过阈值就切换，否则回弹到当前 tab。
 */
export function resolveTarget(
  state: SwipeState,
  currentIndex: number,
  viewport: Viewport,
  tabCount: number
): { target: number; switched: boolean } {
  if (!state.horizontal) return { target: currentIndex, switched: false };
  if (Math.abs(state.deltaX) < SWIPE_THRESHOLD_PX) {
    return { target: currentIndex, switched: false };
  }
  const step = stepPx(viewport, tabCount);
  if (!(step > 0)) return { target: currentIndex, switched: false };

  const target = state.deltaX > 0 ? currentIndex - 1 : currentIndex + 1;
  if (target < 0 || target >= tabCount) {
    // 已经在最边缘，滑动不越界
    return { target: currentIndex, switched: false };
  }
  return { target, switched: true };
}

/**
 * 胶囊的横向位移（px）。
 *
 * progress 是连续值，位移 = (progress - currentIndex) * step，
 * 但实际位移不应超过胶囊宽度的 3/4（iOS 的观感），
 * 超出部分作为回弹阻尼。
 */
export function capsuleOffset(
  progress: number,
  currentIndex: number,
  viewport: Viewport,
  tabCount: number
): number {
  const step = stepPx(viewport, tabCount);
  if (!(step > 0)) return 0;

  const raw = (progress - currentIndex) * step;
  const max = step * 0.75;
  const abs = Math.abs(raw);
  if (abs <= max) return raw;

  // 超出部分做阻尼：越滑越沉，始终不超过 max 的 1.15 倍
  const damped = max + (abs - max) * 0.25;
  const capped = Math.min(damped, max * 1.15);
  return raw > 0 ? capped : -capped;
}
