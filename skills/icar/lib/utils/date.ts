/** 日期工具：统一按本地时区计算（设计报告 5.2.2 强调 UTC+8 本地时区换算） */

const DAY_MS = 86400000;

/** 取某时间戳的本地当日 00:00:00.000 */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 两个时间戳之间相差的整天数（按本地日 00:00 对齐） */
export function daysBetween(fromTs: number, toTs: number): number {
  return Math.floor((startOfDay(toTs) - startOfDay(fromTs)) / DAY_MS);
}

/**
 * 已服役天数：购车日 → 今天。
 *
 * - 按本地日 00:00 对齐，同一天不同时刻算 0 天
 * - 购车日缺失 / 非正数 → null（调用方显示 --）
 * - 购车日在未来 → 钳到 0，不显示负数
 */
export function serviceDaysSince(initDate: number, now: number): number | null {
  if (!(initDate > 0)) return null;
  const days = daysBetween(initDate, now);
  return days > 0 ? days : 0;
}

/** 格式化 "yyyy-MM-dd"（本地时区） */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 格式化 "yyyy-MM-dd HH:mm"（本地时区） */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 取本地月份标签，如 "7月" */
export function monthLabel(ts: number): string {
  return `${new Date(ts).getMonth() + 1}月`;
}

/**
 * 跨年场景下的月份标签：带年份，避免「全部」范围把 2025/7 与 2026/7 合并成一个点。
 * 仅在跨度跨年时使用，单年内仍用短标签以保持紧凑。
 */
export function monthLabelWithYear(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}
