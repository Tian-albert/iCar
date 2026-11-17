/**
 * 保存动作的统一异常兜底 + 防重复提交（R-09）。
 *
 * - service 抛 `ServiceError` 时把**具体原因**显示给用户（如「这条记录已被删除」）
 * - 其它异常（TypeError、存储层原始错误）显示通用兜底文案，
 *   绝不把技术细节抛给用户
 * - 默认带 600ms 节流：连点两次只会执行一次，避免写入重复记录
 *   （保存成功后页面会在 600ms 后返回，节流窗口与之一致）
 *
 * 节流状态**按页面隔离**。改造前是一个模块级的 `lastRunAt`，所有页面共用
 * 同一个窗口：在 A 页保存后 600ms 内切到 B 页保存会被静默忽略，
 * 用户点了「保存」却什么都没发生，也没有任何提示。
 */
import { userMessageOf } from '../services/service-error';

const DEFAULT_THROTTLE_MS = 600;

/** 通用兜底文案：意外异常时显示，不暴露技术细节 */
const GENERIC_FAIL = '保存失败，请重试';

/** key（页面路由）→ 上次执行时间 */
const lastRunAt = new Map<string, number>();

export interface GuardOptions {
  /**
   * 节流分组，默认取当前页面路由。
   * 同一页面里若有两个互不相干的保存动作需要各自节流，可显式传不同 key。
   */
  key?: string;
  /** 节流窗口（ms），传 0 关闭节流 */
  throttleMs?: number;
  /** 失败时的兜底文案（未传则用「保存失败，请重试」） */
  fallbackMessage?: string;
}

export function guardSave(action: () => void, options: GuardOptions | number = {}): boolean {
  // 兼容旧签名 guardSave(action, 600)
  const opts: GuardOptions = typeof options === 'number' ? { throttleMs: options } : options;
  const throttleMs = opts.throttleMs ?? DEFAULT_THROTTLE_MS;
  const key = opts.key ?? currentPageKey();

  const now = Date.now();
  const prev = lastRunAt.get(key) ?? 0;
  if (throttleMs > 0 && now - prev < throttleMs) {
    // 静默忽略重复点击，不打断用户的成功反馈
    return false;
  }
  lastRunAt.set(key, now);

  try {
    action();
    return true;
  } catch (e) {
    // 失败时释放节流窗口，允许用户立即修正后重试
    lastRunAt.delete(key);
    wx.showToast({
      title: userMessageOf(e, opts.fallbackMessage ?? GENERIC_FAIL),
      icon: 'none'
    });
    return false;
  }
}

/**
 * 取当前页面路由作为节流分组。
 *
 * 用页面而不是调用点：同一页里两个按钮在 600ms 内被先后点到的可能性极低，
 * 而按调用点（调用栈行号）分组会让「同一个函数里换一行调用」失去节流效果。
 * 拿不到页面栈时退回固定值，等同于旧行为，不会更糟。
 */
function currentPageKey(): string {
  try {
    if (typeof getCurrentPages === 'function') {
      const pages = getCurrentPages();
      const top: any = pages[pages.length - 1];
      if (top && typeof top.route === 'string' && top.route) return top.route;
    }
  } catch {
    // 页面栈异常时不影响保存本身
  }
  return 'default';
}

/** 仅供单测重置节流状态 */
export function resetSaveGuard(): void {
  lastRunAt.clear();
}
