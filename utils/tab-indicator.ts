// 底部栏选中态指示块的位移计算
//
// 交互：页面（swiper）横向滑动时，底部栏**不动**，只有选中项的浅蓝底块
// 跟着滑动。这是 iOS Tab Bar 的观感——指示器在滑动过程中连续移动，
// 而不是等切换完成后瞬间跳过去。
//
// 数据来源：swiper 的 bindtransition 事件给出 dx（swiper-item 的位移，
// 正为右滑、负为左滑）。由 dx 算出「指示器应该在哪」。

/** 底部栏指示块的宽度占每个 tab 的比例（与 wxss 的 .tab-item 宽度对应） */
export const INDICATOR_WIDTH_RATIO = 1;

/** 指示块的水平内缩（rpx），让底块比图标略小 */
export const INDICATOR_INSET_RPX = 0;

/**
 * 计算指示块的位置（返回它相对第 0 个 tab 左边缘的偏移，单位 px）。
 *
 * @param dx        swiper transition 的 dx：swiper-item 的位移，正为右滑、负为左滑
 * @param current   当前选中的 tab 索引
 * @param count     tab 总数
 * @param step      每个 tab 的步长（px）
 */
export function indicatorOffset(
  dx: number,
  current: number,
  count: number,
  step: number
): number {
  if (!(step > 0) || count <= 0) return 0;

  // dx 为负（向左滑，露出下一个 tab）时，指示器应右移
  const progress = -dx / step;
  const pos = current + progress;

  // 越界时夹紧，不允许指示器跑出栏外
  const min = 0;
  const max = count - 1;
  return Math.min(max, Math.max(min, pos)) * step;
}

/**
 * 由 swiper 的 current 与 dx 推导「应该高亮哪个 tab」。
 *
 * 滑动过程中不真正切换（swiper 自己管），但底栏的图标高亮需要跟手：
 * 用 dx 算出连续位置，取最近的那个作为高亮项。
 */
export function indicatorActiveIndex(
  dx: number,
  current: number,
  count: number,
  step: number
): number {
  if (!(step > 0) || count <= 0) return current;
  const progress = -dx / step;
  const pos = current + progress;
  return Math.min(count - 1, Math.max(0, Math.round(pos)));
}

/**
 * 点击底部栏某个 tab 时，swiper 应该滑到哪。
 *
 * 返回的是 swiper 的 current 目标值；同时给出指示块应落到的像素位置，
 * 供点击时无动画直接跳转使用。
 */
export function tabTarget(
  index: number,
  count: number,
  step: number
): { current: number; offset: number } {
  const safe = Math.min(count - 1, Math.max(0, index));
  return { current: safe, offset: safe * step };
}
