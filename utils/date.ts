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
