/**
 * 保存动作的统一异常兜底 + 防重复提交（R-09）。
 *
 * - service 抛错时给提示，绝不静默失败或白屏
 * - 默认带 600ms 节流：连点两次只会执行一次，避免写入重复记录
 *   （保存成功后页面会在 600ms 后返回，节流窗口与之一致）
 */
const DEFAULT_THROTTLE_MS = 600;

let lastRunAt = 0;

export function guardSave(action: () => void, throttleMs = DEFAULT_THROTTLE_MS): boolean {
  const now = Date.now();
  if (throttleMs > 0 && now - lastRunAt < throttleMs) {
    // 静默忽略重复点击，不打断用户的成功反馈
    return false;
  }
  lastRunAt = now;
  try {
    action();
    return true;
  } catch {
    // 失败时释放节流窗口，允许用户立即修正后重试
    lastRunAt = 0;
    wx.showToast({ title: '保存失败，请检查输入后重试', icon: 'none' });
    return false;
  }
}

/** 仅供单测重置节流状态 */
export function resetSaveGuard(): void {
  lastRunAt = 0;
}
