/**
 * 服务层统一的错误类型与分层约定。
 *
 * ## 为什么需要这个文件
 *
 * 改造前服务层有三种错误处理方式并存：
 *
 * | 方式 | 例子 | 问题 |
 * | --- | --- | --- |
 * | `throw new Error('记录不存在')` | updateCost / updateRepair | **message 没人读**：`guardSave` 一律提示「保存失败，请检查输入后重试」，可实际原因是记录已被删，让用户检查输入纯属误导 |
 * | 返回 `{ ok, message }` | removeCategory / clearAllData | 调用方必须逐处判断，漏判就静默失败 |
 * | 返回 `null` | getCar / getCategory | 语义正确（「查不到」不是错误），但和上面两种混在一起后，调用方无法判断该不该提示 |
 *
 * 三种方式本身各有适用场景，问题在于**没有明确边界**。这里定下规则。
 *
 * ## 分层约定
 *
 * 1. **查询类**（getXxx / listXxx / findXxx）
 *    - 查不到 → 返回 `null` / 空数组。这是正常结果，不是错误。
 *    - 只有底层存储真的坏了才抛错（那种情况应让全局兜底处理）。
 *
 * 2. **写入类**（saveXxx / updateXxx / removeXxx / addXxx）
 *    - 前置条件不满足（记录已被删、目标不存在、缺少必需数据）
 *      → 抛 `ServiceError`，message 必须**直接面向用户**，能原样显示在 toast 里。
 *    - 意外崩溃（存储异常、数据损坏）→ 让原始异常冒泡，
 *      由 `guardSave` 统一兜成「保存失败，请重试」。
 *
 * 3. **批量 / 可部分成功的操作**（导入、清空、批量恢复）
 *    - 返回 `{ ok, message?, ... }`。因为「部分成功」无法用异常表达，
 *      而调用方需要拿到进度数字（added / cleared / removed）。
 *
 * ## 为什么不用 `throw new Error` 直接抛
 *
 * 因为**无法区分**「这条错误该不该给用户看」。
 * `guardSave` 需要知道：是显示具体原因，还是显示通用兜底文案。
 * 用独立的类做标记，运行时用 `instanceof` 判断，不依赖 message 文本匹配。
 */

/**
 * 可以安全展示给用户的业务错误。
 *
 * message 会被原样放进 toast，因此：
 * - 用中文，不出现字段名、表名、函数名
 * - 说清「发生了什么」，必要时给出下一步动作
 * - 不超过 20 个字（toast 两行内能显示完）
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    // 继承内置 Error 时必须修正原型链：ES5 目标下 instanceof 会失效
    Object.setPrototypeOf(this, ServiceError.prototype);
    this.name = 'ServiceError';
  }
}

/** 便捷构造：`throw serviceError('记录已被删除')` */
export function serviceError(message: string): ServiceError {
  return new ServiceError(message);
}

/**
 * 判断一个异常是否适合把 message 展示给用户。
 *
 * 只有 `ServiceError` 才算 —— 其它异常（TypeError、存储层抛的原始错误）
 * 的 message 是给开发者看的，直接显示给用户只会让人困惑。
 */
export function isUserFacingError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

/**
 * 从任意异常里取出「可以展示给用户的文案」。
 *
 * 不是 ServiceError 时返回 fallback，绝不把技术细节抛给用户。
 */
export function userMessageOf(e: unknown, fallback: string): string {
  if (isUserFacingError(e) && e.message) return e.message;
  return fallback;
}
