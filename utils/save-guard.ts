/** 保存动作的统一异常兜底（R-09）：service 抛错时给提示，绝不静默失败或白屏 */
export function guardSave(action: () => void): boolean {
  try {
    action();
    return true;
  } catch {
    wx.showToast({ title: '保存失败，请检查输入后重试', icon: 'none' });
    return false;
  }
}
