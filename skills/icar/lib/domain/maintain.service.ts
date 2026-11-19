// 保养剩余量计算（对齐设计报告 5.3.2 / 7.4）
import { Car, Maintain, MaintainHandle } from '../types/models';
import { clamp01 } from '../utils/number';
import { daysBetween } from '../utils/date';

export interface MaintainRemaining {
  maintain: Maintain;
  remainMileage: number | null; // null 表示未配置里程周期
  remainDays: number | null; // null 表示未配置天数周期
  progress: number; // 0~1，剩余比例（进度条蓝色填充长度）
  urgent: boolean;
}

/** 保养提醒阈值（可自定义） */
export interface MaintainThresholds {
  mileage: number; // 剩余里程阈值 (km)
  days: number; // 剩余天数阈值 (天)
}

export const DEFAULT_MAINTAIN_THRESHOLDS: MaintainThresholds = {
  mileage: 500,
  days: 15
};

/**
 * 计算保养项剩余量。
 *
 * 里程基线 = 最近一次保养执行里程，无记录则取 car.initMileages。
 * 天数基线 = 最近一次保养日期，无记录则取 car.initDate。
 * 进度条 = 剩余比例（里程周期优先，其次天数周期）。
 * urgent = 剩余里程 ≤ thresholds.mileage 或 剩余天数 ≤ thresholds.days。
 */
export function calcRemaining(
  maintain: Maintain,
  lastHandle: MaintainHandle | null,
  car: Car,
  today: number,
  thresholds: MaintainThresholds = DEFAULT_MAINTAIN_THRESHOLDS
): MaintainRemaining {
  const baseMileage = lastHandle ? lastHandle.makeMileages : car.initMileages;
  const usedMileage = car.mileages - baseMileage;

  const remainMileage =
    maintain.cycleMileages > 0 ? maintain.cycleMileages - usedMileage : null;

  let remainDays: number | null = null;
  if (maintain.cycleDays > 0) {
    const baseDate = lastHandle ? lastHandle.makeDate : car.initDate;
    remainDays = maintain.cycleDays - daysBetween(baseDate, today);
  }

  const progress =
    remainMileage !== null && maintain.cycleMileages > 0
      ? clamp01(remainMileage / maintain.cycleMileages)
      : remainDays !== null && maintain.cycleDays > 0
        ? clamp01(remainDays / maintain.cycleDays)
        : 0;

  return {
    maintain,
    remainMileage,
    remainDays,
    progress,
    urgent:
      (remainMileage !== null && remainMileage <= thresholds.mileage) ||
      (remainDays !== null && remainDays <= thresholds.days)
  };
}

/**
 * 把剩余量格式化成一句展示文案。
 *
 * 正数 → 「剩余 X 天 / 剩余 X km」；负数（已超期）→「超期 X 天 / 超期 X km」，
 * 取绝对值，避免出现「剩余 -100 天」这种反直觉文案。
 *
 * 展示优先级与 calcRemaining 的进度口径一致：天数优先，其次里程。
 * 与 services/overview.service.ts 的 remainTextOf 语义相同，措辞对齐车辆详情 / 保养管理页。
 */
export function formatRemainText(
  remainMileage: number | null,
  remainDays: number | null
): string {
  if (remainDays !== null) {
    return remainDays < 0
      ? `超期 ${Math.abs(remainDays)} 天`
      : `剩余 ${remainDays} 天`;
  }
  if (remainMileage !== null) {
    return remainMileage < 0
      ? `超期 ${Math.abs(remainMileage)} km`
      : `剩余 ${remainMileage} km`;
  }
  return '';
}

/**
 * 剩余量是否已超期（负数）—— 任一维度为负即算。
 *
 * 超期与「临近」要区分开：临近用 --color-warning（橙），
 * 超期用 --color-danger（红），与概览页 level = bad/warn 的语义对齐。
 */
export function isRemainOverdue(
  remainMileage: number | null,
  remainDays: number | null
): boolean {
  return (remainMileage !== null && remainMileage < 0) || (remainDays !== null && remainDays < 0);
}

/** 取某保养项的最近一次保养执行（由 MaintainLog 关联） */
export function findLastHandle(
  maintain: Maintain,
  logs: Array<{ maintainSourceId: string; handleSourceId: string }>,
  handles: MaintainHandle[]
): MaintainHandle | null {
  const handleIds = logs
    .filter(l => l.maintainSourceId === maintain.sourceId)
    .map(l => l.handleSourceId);
  if (!handleIds.length) return null;
  const related = handles.filter(h => handleIds.includes(h.sourceId));
  if (!related.length) return null;
  return related.reduce((a, b) => (a.makeDate >= b.makeDate ? a : b));
}
