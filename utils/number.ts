/** 金额与数值工具（对齐设计报告 7.3/7.6 的 round2） */

/** 四舍五入到 2 位小数，规避浮点误差 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 四舍五入到 3 位小数（用于"元/km"等小数值指标，如 1.317） */
export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** 收敛到 [0, 1] */
export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * 解析「可留空」的金额输入（如加油的实付金额）。
 * - 空串：ok=true, value=null，由调用方回退默认值（应付金额）
 * - 非数字 / 负数 / Infinity：ok=false，调用方应提示并中止保存
 * - 其余：四舍五入到 2 位
 */
export function parseAmountInput(raw: string): { ok: boolean; value: number | null } {
  const text = (raw || '').trim();
  if (!text) return { ok: true, value: null };
  const n = Number(text);
  if (!isFinite(n) || n < 0) return { ok: false, value: null };
  return { ok: true, value: round2(n) };
}
