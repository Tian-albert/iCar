/**
 * 隐私授权兜底
 *
 * 调用相册、文件选择等敏感 API 前，先确保用户已同意《用户隐私保护指引》。
 * - 基础库 2.32.3+：调用 wx.requirePrivacyAuthorize，未同意时自动弹官方隐私弹窗；
 * - 低版本 / 不支持该 API：直接放行（微信未强制校验）。
 */
export function ensurePrivacyAuthorize(): Promise<boolean> {
  return new Promise(resolve => {
    const requireAuth = (wx as any).requirePrivacyAuthorize;
    if (typeof requireAuth !== 'function') {
      resolve(true);
      return;
    }
    requireAuth({
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}
