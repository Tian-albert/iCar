// 统计页分享卡片：数据模型 + 布局（纯函数，便于单测）
//
// 为什么需要这套模型：小程序没有「整页截图」能力，canvasToTempFilePath 只能导出
// canvas 内容。所以分享图必须在离屏 canvas 上**重绘**，把统计页的关键指标
// 重新排版成一张适合朋友圈传播的卡片，而不是截取页面。
import { EnergyType } from '../types/models';
import { StatsRange } from '../domain/stats.service';

/** 卡片宽度（px）：750 设计稿下 2 倍图，朋友圈预览清晰 */
export const CARD_WIDTH = 750;

/** 分类最多展示条数，超出合并为「其他」，避免卡片过长 */
export const MAX_CATEGORIES = 6;

export interface ShareCategoryInput {
  name: string;
  amount: number;
  percent: number;
}

export interface ShareCardInput {
  carName: string;
  energyType: EnergyType;
  rangeLabel: string;
  hasData: boolean;
  mileage: { latest: number; increased: number; fuelMileage: number; evMileage: number };
  fuel: { totalCost: number; avgConsumption: number; costPerKm: number };
  electricity: { totalCost: number; avgConsumption: number; costPerKm: number };
  expense: { total: number; perKm: number };
  categories: ShareCategoryInput[];
}

export interface ShareMetric {
  label: string;
  value: string;
}

export interface ShareCategory {
  name: string;
  amount: string;
  percent: string;
  /** 0~1，用于绘制占比条 */
  ratio: number;
}

export interface ShareCardModel {
  carName: string;
  energyLabel: string;
  rangeLabel: string;
  hasData: boolean;
  metrics: ShareMetric[];
  categories: ShareCategory[];
  expenseTotal: string;
}

export interface MetricLayout {
  label: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CategoryLayout {
  name: string;
  amount: string;
  percent: string;
  x: number;
  y: number;
  barWidth: number;
  barMaxWidth: number;
}

export interface ShareCardLayout {
  width: number;
  height: number;
  padding: number;
  titleBaseline: number;
  subtitleBaseline: number;
  /** 指标区起始 y */
  metricsTop: number;
  metrics: MetricLayout[];
  /** 分类区标题基线；无分类时为 null */
  categoryTitleBaseline: number | null;
  categories: CategoryLayout[];
  footerBaseline: number;
}

const ENERGY_LABEL: Record<EnergyType, string> = {
  fuel: '燃油',
  ev: '纯电',
  hybrid: '混动'
};

/** 数值格式化：非有限数一律视为无数据 */
function fmt(v: number, digits = 2): string {
  return typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '--';
}

/** 整数格式化（里程） */
function fmtInt(v: number): string {
  return typeof v === 'number' && isFinite(v) ? String(Math.round(v)) : '--';
}

/** 维度标签：月 / 年 / 全部 */
export function formatRangeLabel(range: StatsRange): string {
  if (range.type === 'month') return `${range.year}年${range.month}月`;
  if (range.type === 'year') return `${range.year}年`;
  return '全部时间';
}

/**
 * 组装分享卡片模型。
 * 车型分支与统计页保持一致：纯电只看电耗，燃油只看油耗，混动两组都给。
 */
export function buildShareCardModel(input: ShareCardInput): ShareCardModel {
  const { energyType, hasData } = input;
  const isEv = energyType === 'ev';
  const isHybrid = energyType === 'hybrid';

  const metrics: ShareMetric[] = [];

  // 里程：纯电取 evMileage（fuelMileage 恒为 0），燃油取 fuelMileage，混动两者都给
  metrics.push({ label: '最新总里程', value: hasData ? fmtInt(input.mileage.latest) : '--' });
  metrics.push({ label: '增加总里程', value: hasData ? fmtInt(input.mileage.increased) : '--' });
  if (isEv) {
    metrics.push({ label: '充电里程', value: hasData ? fmtInt(input.mileage.evMileage) : '--' });
  } else if (isHybrid) {
    metrics.push({ label: '加油里程', value: hasData ? fmtInt(input.mileage.fuelMileage) : '--' });
    metrics.push({ label: '充电里程', value: hasData ? fmtInt(input.mileage.evMileage) : '--' });
  } else {
    metrics.push({ label: '加油里程', value: hasData ? fmtInt(input.mileage.fuelMileage) : '--' });
  }

  // 能耗指标
  if (!isEv) {
    metrics.push({ label: '总油费', value: hasData ? fmt(input.fuel.totalCost) : '--' });
    metrics.push({ label: '平均油耗', value: hasData ? fmt(input.fuel.avgConsumption) : '--' });
    metrics.push({ label: '油耗成本', value: hasData ? fmt(input.fuel.costPerKm, 3) : '--' });
  }
  if (isEv || isHybrid) {
    metrics.push({ label: '总电费', value: hasData ? fmt(input.electricity.totalCost) : '--' });
    metrics.push({ label: '平均电耗', value: hasData ? fmt(input.electricity.avgConsumption) : '--' });
    metrics.push({ label: '电耗成本', value: hasData ? fmt(input.electricity.costPerKm, 3) : '--' });
  }

  // 支出
  metrics.push({ label: '总支出', value: hasData ? fmt(input.expense.total) : '--' });
  metrics.push({ label: '每公里支出', value: hasData ? fmt(input.expense.perKm, 3) : '--' });

  // 分类：降序 + 截断 + 合并「其他」
  const sorted = [...input.categories]
    .filter(c => isFinite(c.amount) && c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  let categories: ShareCategory[] = [];
  if (sorted.length > 0) {
    const keep = sorted.length > MAX_CATEGORIES ? MAX_CATEGORIES - 1 : sorted.length;
    const head = sorted.slice(0, keep);
    const tail = sorted.slice(keep);

    const total = sorted.reduce((s, c) => s + c.amount, 0);
    const toView = (c: ShareCategoryInput): ShareCategory => ({
      name: c.name,
      amount: fmt(c.amount),
      percent: `${fmt(c.percent, 1)}%`,
      ratio: total > 0 ? Math.min(1, c.amount / total) : 0
    });

    categories = head.map(toView);
    if (tail.length > 0) {
      const restAmount = tail.reduce((s, c) => s + c.amount, 0);
      const restPercent = tail.reduce((s, c) => s + c.percent, 0);
      categories.push(toView({ name: '其他', amount: restAmount, percent: restPercent }));
    }
  }

  return {
    carName: input.carName || '我的爱车',
    energyLabel: ENERGY_LABEL[energyType] || '燃油',
    rangeLabel: input.rangeLabel,
    hasData,
    metrics,
    categories,
    expenseTotal: hasData ? fmt(input.expense.total) : '--'
  };
}

/**
 * 计算卡片布局。所有坐标基于 CARD_WIDTH 宽度的画布。
 * 返回的高度即为导出画布高度。
 */
export function computeShareCardLayout(model: ShareCardModel): ShareCardLayout {
  const padding = 48;
  const contentW = CARD_WIDTH - padding * 2;

  const titleBaseline = 96;
  const subtitleBaseline = 140;
  const metricsTop = 188;

  // 指标两列网格
  const COLS = 2;
  const cellW = contentW / COLS;
  const cellH = 84;
  const metrics: MetricLayout[] = model.metrics.map((m, i) => ({
    label: m.label,
    value: m.value,
    x: padding + (i % COLS) * cellW,
    y: metricsTop + Math.floor(i / COLS) * cellH,
    width: cellW,
    height: cellH
  }));

  const rows = Math.ceil(model.metrics.length / COLS);
  let cursor = metricsTop + rows * cellH + 20;

  const categoryTitleBaseline = model.categories.length > 0 ? cursor + 28 : null;
  if (categoryTitleBaseline !== null) cursor = categoryTitleBaseline + 16;

  const CAT_ROW_H = 62;
  const BAR_MAX_W = contentW - 150;
  const categories: CategoryLayout[] = model.categories.map((c, i) => ({
    name: c.name,
    amount: c.amount,
    percent: c.percent,
    x: padding,
    y: cursor + i * CAT_ROW_H,
    barWidth: Math.max(0, Math.min(1, c.ratio)) * BAR_MAX_W,
    barMaxWidth: BAR_MAX_W
  }));

  if (categories.length > 0) {
    cursor += categories.length * CAT_ROW_H;
  }

  const footerBaseline = cursor + 56;
  const height = footerBaseline + 72;

  return {
    width: CARD_WIDTH,
    height,
    padding,
    titleBaseline,
    subtitleBaseline,
    metricsTop,
    metrics,
    categoryTitleBaseline,
    categories,
    footerBaseline
  };
}
