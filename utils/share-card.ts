// 统计页分享卡片：数据模型 + 布局（纯函数，便于单测）
//
// 设计目标：**1:1 复刻统计页**的布局与内容，而不是做一张简化摘要图。
// 页面结构（自上而下）：
//   顶部深色头（车名 / 车型 / 维度 / 品牌）
//   里程指标卡（3 列）
//   油耗指标卡（3 列，纯电隐藏）
//   电耗指标卡（3 列，纯电 / 混动显示）
//   支出指标卡（3 列）
//   分类支出（环形图 + 明细列表）
//   {能耗}趋势（折线图）
//   行程（柱状图）
//   费用（柱状图）
//
// 技术约束：小程序无「整页截图」能力，canvasToTempFilePath 只能导出 canvas 内容，
// 因此在离屏 canvas 上按上述结构重绘，图表绘制复用 utils/chart-render 的同一份算法。
import { EnergyType } from '../types/models';
import { StatsRange } from '../domain/stats.service';

/** 卡片逻辑宽度：750 = 设计稿 2 倍图，朋友圈预览清晰 */
export const CARD_WIDTH = 750;

/**
 * 分享模式：
 * - `brief` 精简：指标卡 + 分类环形图，适合朋友圈快速浏览
 * - `full` 详细：1:1 复刻统计页（含趋势折线、行程/费用柱状图）
 */
export type ShareMode = 'brief' | 'full';

/** 图表字号缩放：卡片宽度约为页面 2.2 倍，字号同步放大才看得清 */
export const CHART_FONT_SCALE = 2.2;

/** 分类明细列表最多展示条数（环形图仍用全量） */
export const MAX_CATEGORY_ROWS = 6;

export interface ShareCategoryInput {
  name: string;
  amount: number;
  percent: number;
  color: string;
}

export interface ShareCardInput {
  carName: string;
  energyType: EnergyType;
  rangeLabel: string;
  hasData: boolean;
  mileage: { latest: number; increased: number; fuelMileage: number; evMileage: number };
  fuel: { totalCost: number; avgConsumption: number; costPerKm: number };
  electricity: { totalCost: number; avgConsumption: number; costPerKm: number };
  expense: { total: number; perKm: number; perKmExFuel: number };
  categories: ShareCategoryInput[];
  trendUnit: string;
  trend: Array<{ label: string; value: number }>;
  monthlyMileage: Array<{ label: string; value: number }>;
  monthlyCost: Array<{ label: string; value: number }>;
}

/** 指标卡中的一列 */
export interface ShareMetric {
  label: string;
  value: string;
}

/** 一组指标卡（对应页面上一个白色卡片，3 列） */
export interface ShareMetricGroup {
  key: 'mileage' | 'fuel' | 'electricity' | 'expense';
  metrics: ShareMetric[];
}

export interface ShareCategoryRow {
  name: string;
  /** 展示用金额（已格式化） */
  amount: string;
  /** 展示用百分比（已格式化） */
  percent: string;
  /** 原始数值，供环形图计算扇区角度 */
  percentValue: number;
  color: string;
}

export interface ShareCardModel {
  carName: string;
  energyLabel: string;
  rangeLabel: string;
  hasData: boolean;
  /** 精简 / 详细模式，决定布局是否包含三张图表 */
  mode: ShareMode;
  /** 按页面顺序排列的指标卡组 */
  groups: ShareMetricGroup[];
  /** 分类环形图数据（全量） */
  categories: ShareCategoryRow[];
  /** 分类明细列表（可能被截断） */
  categoryRows: ShareCategoryRow[];
  /** 被截断未展示的分类条数，>0 时卡片末尾提示「等 N 项」 */
  categoryHiddenCount: number;
  categoryTotal: string;
  trendTitle: string;
  trendUnit: string;
  trend: Array<{ label: string; value: number }>;
  trendEmptyText: string;
  monthlyMileage: Array<{ label: string; value: number }>;
  monthlyMileageEmpty: boolean;
  monthlyCost: Array<{ label: string; value: number }>;
  monthlyCostEmpty: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShareCardLayout {
  width: number;
  height: number;
  padding: number;
  mode: ShareMode;
  header: Rect;
  titleBaseline: number;
  subtitleBaseline: number;
  /** 各指标卡组的绘制区域与列坐标 */
  groupRects: Array<{ key: string; rect: Rect; metrics: Array<ShareMetric & Rect> }>;
  /** 分类区 */
  categoryTitleBaseline: number;
  categoryCard: Rect;
  donutRect: Rect;
  categoryRowRects: Array<ShareCategoryRow & Rect>;
  /** 趋势区（精简模式下为 null，绘制时跳过） */
  trendTitleBaseline: number | null;
  trendCard: Rect | null;
  trendChartRect: Rect | null;
  /** 行程区（精简模式下为 null） */
  mileageTitleBaseline: number | null;
  mileageCard: Rect | null;
  mileageChartRect: Rect | null;
  /** 费用区（精简模式下为 null） */
  costTitleBaseline: number | null;
  costCard: Rect | null;
  costChartRect: Rect | null;
  footerBaseline: number;
}

const ENERGY_LABEL: Record<EnergyType, string> = {
  fuel: '燃油',
  ev: '纯电',
  hybrid: '混动'
};

function fmt(v: number, digits = 2): string {
  return typeof v === 'number' && isFinite(v) ? v.toFixed(digits) : '--';
}

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
 * 指标卡组与统计页完全对应：里程 → 油耗（纯电隐藏）→ 电耗（纯电/混动）→ 支出。
 */
export function buildShareCardModel(input: ShareCardInput, mode: ShareMode = 'full'): ShareCardModel {
  const { energyType, hasData } = input;
  const isEv = energyType === 'ev';
  const isHybrid = energyType === 'hybrid';
  const v = (s: string) => (hasData ? s : '--');

  // ---- 里程卡（3 列）----
  // 标签带单位，与页面 index.wxml 保持一致
  const mileageMetrics: ShareMetric[] = [
    { label: '最新总里程 (km)', value: v(fmtInt(input.mileage.latest)) },
    { label: '增加总里程 (km)', value: v(fmtInt(input.mileage.increased)) },
    isEv
      ? { label: '充电里程 (km)', value: v(fmtInt(input.mileage.evMileage)) }
      : { label: '加油里程 (km)', value: v(fmtInt(input.mileage.fuelMileage)) }
  ];

  const groups: ShareMetricGroup[] = [{ key: 'mileage', metrics: mileageMetrics }];

  // ---- 油耗卡（纯电隐藏）----
  if (!isEv) {
    groups.push({
      key: 'fuel',
      metrics: [
        { label: '总油费 (元)', value: v(fmt(input.fuel.totalCost)) },
        { label: '平均油耗 (L/100km)', value: v(fmt(input.fuel.avgConsumption)) },
        { label: '平均油耗 (元/km)', value: v(fmt(input.fuel.costPerKm, 3)) }
      ]
    });
  }

  // ---- 电耗卡（纯电 / 混动）----
  if (isEv || isHybrid) {
    groups.push({
      key: 'electricity',
      metrics: [
        { label: '总电费 (元)', value: v(fmt(input.electricity.totalCost)) },
        { label: '平均电耗 (kWh/100km)', value: v(fmt(input.electricity.avgConsumption)) },
        { label: '每公里电费 (元/km)', value: v(fmt(input.electricity.costPerKm, 3)) }
      ]
    });
  }

  // ---- 支出卡 ----
  groups.push({
    key: 'expense',
    metrics: [
      { label: '总支出 (元)', value: v(fmt(input.expense.total)) },
      { label: '每公里支出 (元/km)', value: v(fmt(input.expense.perKm, 3)) },
      { label: '除掉油费 (元/km)', value: v(fmt(input.expense.perKmExFuel, 3)) }
    ]
  });

  // ---- 分类支出 ----
  const validCats = input.categories
    .filter(c => isFinite(c.amount) && c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const categoryRowsAll: ShareCategoryRow[] = validCats.map(c => ({
    name: c.name,
    amount: fmt(c.amount),
    percent: `${fmt(c.percent, 2)}%`,
    percentValue: isFinite(c.percent) ? c.percent : 0,
    color: c.color
  }));

  return {
    carName: input.carName || '我的爱车',
    energyLabel: ENERGY_LABEL[energyType] || '燃油',
    rangeLabel: input.rangeLabel,
    hasData,
    mode,
    groups,
    categories: categoryRowsAll,
    categoryRows: categoryRowsAll.slice(0, MAX_CATEGORY_ROWS),
    categoryHiddenCount: Math.max(0, categoryRowsAll.length - MAX_CATEGORY_ROWS),
    categoryTotal: v(fmt(input.expense.total)),
    trendTitle: `${isEv ? '电耗' : '能耗'}趋势 (${input.trendUnit})`,
    trendUnit: input.trendUnit,
    trend: input.trend,
    trendEmptyText: isEv
      ? '暂无有效充电区间，记录两次充满充电后生成趋势'
      : '暂无有效油耗区间，记录两次加满加油后生成趋势',
    monthlyMileage: input.monthlyMileage,
    monthlyMileageEmpty: input.monthlyMileage.length === 0,
    monthlyCost: input.monthlyCost,
    monthlyCostEmpty: input.monthlyCost.length === 0
  };
}

// ---------------- 布局常量（与页面 rpx 尺寸一一对应，750 宽直接映射）----------------

const PAD = 24;                 // 页面左右 padding 24rpx
const GROUP_H = 132;            // 指标卡高度
const GROUP_GAP = 20;           // 卡片间距 20rpx
const SECTION_TITLE_H = 60;     // 小节标题占位
const DONUT_H = 500;            // .donut-chart height: 500rpx
const CAT_ROW_H = 52;           // 分类明细行高
const CHART_H = 300;            // .chart height: 300rpx
const CARD_PAD = 24;            // .cat-card padding 24rpx

/**
 * 计算卡片布局。坐标基于 CARD_WIDTH 宽度的逻辑画布。
 * 结构与统计页 WXML 一一对应，保证「1:1 复刻」。
 */
export function computeShareCardLayout(model: ShareCardModel): ShareCardLayout {
  const width = CARD_WIDTH;
  const contentW = width - PAD * 2;
  let y = 0;

  // ---- 头部深色区 ----
  const headerH = 168;
  const header: Rect = { x: 0, y: 0, width, height: headerH };
  const titleBaseline = 78;
  const subtitleBaseline = 122;
  y = headerH + 20;

  // ---- 指标卡组 ----
  const groupRects: ShareCardLayout['groupRects'] = [];
  for (const g of model.groups) {
    const rect: Rect = { x: PAD, y, width: contentW, height: GROUP_H };
    const colW = contentW / g.metrics.length;
    const metrics = g.metrics.map((m, i) => ({
      label: m.label,
      value: m.value,
      x: rect.x + colW * i,
      y: rect.y,
      width: colW,
      height: GROUP_H
    }));
    groupRects.push({ key: g.key, rect, metrics });
    y += GROUP_H + GROUP_GAP;
  }

  // ---- 分类支出 ----
  const categoryTitleBaseline = y + SECTION_TITLE_H - 16;
  y += SECTION_TITLE_H;

  const donutRect: Rect = {
    x: PAD + CARD_PAD,
    y: y + CARD_PAD,
    width: contentW - CARD_PAD * 2,
    height: DONUT_H
  };
  const rowStartY = donutRect.y + DONUT_H + 8;
  // 截断提示行需要额外高度，否则会画到卡片外
  const hiddenTipH = model.categoryHiddenCount > 0 && model.categoryRows.length > 0 ? 40 : 0;
  const catInnerH = CARD_PAD * 2 + DONUT_H + (model.categoryRows.length > 0
    ? model.categoryRows.length * CAT_ROW_H + 8 + hiddenTipH
    : 0);

  const categoryCard: Rect = { x: PAD, y, width: contentW, height: catInnerH };
  const categoryRowRects = model.categoryRows.map((r, i) => ({
    ...r,
    x: categoryCard.x + CARD_PAD,
    y: rowStartY + i * CAT_ROW_H,
    width: contentW - CARD_PAD * 2,
    height: CAT_ROW_H
  }));
  y += catInnerH + GROUP_GAP;

  // 精简模式到分类区结束，不再绘制三张图表
  const isFull = model.mode === 'full';

  let trendTitleBaseline: number | null = null;
  let trendCard: Rect | null = null;
  let trendChartRect: Rect | null = null;
  let mileageTitleBaseline: number | null = null;
  let mileageCard: Rect | null = null;
  let mileageChartRect: Rect | null = null;
  let costTitleBaseline: number | null = null;
  let costCard: Rect | null = null;
  let costChartRect: Rect | null = null;

  if (isFull) {
    // ---- 趋势 ----
    trendTitleBaseline = y + SECTION_TITLE_H - 16;
    y += SECTION_TITLE_H;
    trendCard = { x: PAD, y, width: contentW, height: CHART_H + CARD_PAD * 2 };
    trendChartRect = {
      x: PAD + CARD_PAD,
      y: y + CARD_PAD,
      width: contentW - CARD_PAD * 2,
      height: CHART_H
    };
    y += trendCard.height + GROUP_GAP;

    // ---- 行程 ----
    mileageTitleBaseline = y + SECTION_TITLE_H - 16;
    y += SECTION_TITLE_H;
    mileageCard = { x: PAD, y, width: contentW, height: CHART_H + CARD_PAD * 2 };
    mileageChartRect = {
      x: PAD + CARD_PAD,
      y: y + CARD_PAD,
      width: contentW - CARD_PAD * 2,
      height: CHART_H
    };
    y += mileageCard.height + GROUP_GAP;

    // ---- 费用 ----
    costTitleBaseline = y + SECTION_TITLE_H - 16;
    y += SECTION_TITLE_H;
    costCard = { x: PAD, y, width: contentW, height: CHART_H + CARD_PAD * 2 };
    costChartRect = {
      x: PAD + CARD_PAD,
      y: y + CARD_PAD,
      width: contentW - CARD_PAD * 2,
      height: CHART_H
    };
    y += costCard.height;
  }

  const footerBaseline = y + 64;
  const height = footerBaseline + 48;

  return {
    width,
    height,
    padding: PAD,
    mode: model.mode,
    header,
    titleBaseline,
    subtitleBaseline,
    groupRects,
    categoryTitleBaseline,
    categoryCard,
    donutRect,
    categoryRowRects,
    trendTitleBaseline,
    trendCard,
    trendChartRect,
    mileageTitleBaseline,
    mileageCard,
    mileageChartRect,
    costTitleBaseline,
    costCard,
    costChartRect,
    footerBaseline
  };
}
