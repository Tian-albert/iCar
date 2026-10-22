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
