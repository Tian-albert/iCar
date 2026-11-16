/**
 * 保存成功后延迟返回上一页。
 *
 * 直接 `setTimeout(() => wx.navigateBack(), 600)` 有两个问题：
 *
 * 1. **多退一页**：用户在 600ms 内自己点了返回，定时器仍会触发，
 *    又把**上一页**退掉，用户会觉得「怎么退了两层」。
 * 2. **不可取消**：页面已卸载，定时器照样执行。
 *
 * 做法：真正返回前确认「页面栈顶仍是调用它的那一页」，
 * 不是就说明用户已经自己离开，直接放弃。
 */
const DEFAULT_DELAY_MS = 600;

export function safeBack(ctx: any, delay = DEFAULT_DELAY_MS): void {
  setTimeout(() => {
    // 单测环境没有页面栈，按原行为直接返回即可
    if (typeof getCurrentPages !== 'function') {
      wx.navigateBack();
      return;
    }
    const pages = getCurrentPages();
    const top = pages[pages.length - 1];
    // 用户已自行离开该页 → 不要替他再退一层
    if (ctx && top !== ctx) return;
    wx.navigateBack();
  }, delay);
}
