// 统计页分享卡片：Canvas 绘制（1:1 复刻统计页）
//
// 图表部分直接调用 utils/chart-render 的 renderDonut / renderLine / renderBars，
// 与页面上三个组件共用同一份算法 —— 这是「1:1 复刻」的技术保证，
// 否则两套绘制实现迟早会漂移。
//
// Canvas 2D 不解析 CSS 变量，颜色统一取自 CHART_THEME。
import { CHART_THEME } from './chart-draw';
import { renderDonut, renderLine, renderBars } from './chart-render';
import {
  ShareCardLayout,
  ShareCardModel,
  CARD_WIDTH,
  CHART_FONT_SCALE,
  Rect
} from './share-card';

/** 卡片色板：与 app.wxss 令牌一致 */
export const CARD_COLORS = {
  pageBg: '#F5F6F8',
  cardBg: CHART_THEME.card,
  primary: CHART_THEME.primary,
  primaryDark: CHART_THEME.primaryDark,
  text1: CHART_THEME.text1,
  text2: '#5A6272',
  text3: CHART_THEME.text3,
  label: CHART_THEME.label,
  grid: CHART_THEME.grid,
  border: CHART_THEME.border,
  headerTop: '#1E2536',
  headerBottom: '#2A3450'
} as const;

export interface DrawCardOptions {
  ctx: any;
  model: ShareCardModel;
  layout: ShareCardLayout;
  dpr: number;
  footerText?: string;
  dateText?: string;
}

const FONT_FAMILY = 'sans-serif';

function font(size: number, weight = 'normal'): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** 圆角矩形路径（不 fill，调用方决定填充/描边） */
function roundRectPath(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillCard(ctx: any, rect: Rect, radius = 16): void {
  ctx.fillStyle = CARD_COLORS.cardBg;
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fill();
}

/** 小节标题（左对齐） */
function drawSectionTitle(ctx: any, text: string, baseline: number, padding: number): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CARD_COLORS.text1;
  ctx.font = font(28, 'bold');
  ctx.fillText(text, padding, baseline);
}

/** 图表空态文案（居中） */
function drawChartEmpty(ctx: any, text: string, rect: Rect): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.font = font(24);
  // 手动折行：卡片宽度有限，长文案必须换行否则会被裁掉
  const maxW = rect.width - 40;
  const chars = text.split('');
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineH = 36;
  const startY = rect.y + rect.height / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, rect.x + rect.width / 2, startY + i * lineH));
}

/**
 * 绘制整张分享卡片。
 * 画布物理尺寸由调用方按 dpr 预设，本函数内部只做一次 scale。
 */
export function drawShareCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr } = opts;
  const W = layout.width;
  const H = layout.height;
  const pad = layout.padding;

  ctx.save();
  ctx.scale(dpr, dpr);

  // ---------- 页面底 ----------
  ctx.fillStyle = CARD_COLORS.pageBg;
  ctx.fillRect(0, 0, W, H);

  // ---------- 头部深色区 ----------
  const hd = layout.header;
  const grad = ctx.createLinearGradient(0, 0, W, hd.height);
  grad.addColorStop(0, CARD_COLORS.headerTop);
  grad.addColorStop(1, CARD_COLORS.headerBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(hd.x, hd.y, hd.width, hd.height);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(40, 'bold');
  ctx.fillText(model.carName, pad, layout.titleBaseline);

  ctx.font = font(24);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${model.energyLabel} · ${model.rangeLabel}`, pad, layout.subtitleBaseline);

  // 右上角品牌（用户要求保留）
  ctx.textAlign = 'right';
  ctx.font = font(26, 'bold');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('车记本', W - pad, layout.titleBaseline);
  ctx.font = font(20);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('iCar', W - pad, layout.titleBaseline + 34);

  // ---------- 指标卡组 ----------
  for (const group of layout.groupRects) {
    fillCard(ctx, group.rect);
    for (const m of group.metrics) {
      const cx = m.x + m.width / 2;
      // 数值
      ctx.textAlign = 'center';
      ctx.fillStyle = CARD_COLORS.text1;
      ctx.font = font(36, 'bold');
      ctx.fillText(m.value, cx, m.y + 62);
      // 标签
      ctx.fillStyle = CARD_COLORS.text3;
      ctx.font = font(20);
      ctx.fillText(m.label, cx, m.y + 98);
    }
  }

  // ---------- 分类支出 ----------
  drawSectionTitle(ctx, '分类支出', layout.categoryTitleBaseline, pad);
  // 右侧总支出
  ctx.textAlign = 'right';
  ctx.font = font(22);
  ctx.fillStyle = CARD_COLORS.text2;
  ctx.fillText(`总支出 ¥${model.categoryTotal}`, W - pad, layout.categoryTitleBaseline);

  fillCard(ctx, layout.categoryCard);

  if (model.categories.length === 0) {
    drawChartEmpty(ctx, '暂无支出数据，记一笔后即可查看分类占比', layout.donutRect);
  } else {
    // 环形图：与页面组件同一算法
    ctx.save();
    ctx.translate(layout.donutRect.x, layout.donutRect.y);
    renderDonut({
      ctx,
      w: layout.donutRect.width,
      h: layout.donutRect.height,
      // 环形图需要数值型 percent 计算扇区角度
      segments: model.categories.map(c => ({
        name: c.name,
        amount: c.amount,
        percent: c.percentValue,
        color: c.color
      })),
      total: model.categoryTotal,
      // 卡片宽度约为页面 2.2 倍，字号同步放大才看得清
      fontScale: CHART_FONT_SCALE
    });
    ctx.restore();
  }

  // 分类明细列表
  for (const row of layout.categoryRowRects) {
    const dotR = 8;
    ctx.beginPath();
    ctx.arc(row.x + dotR, row.y + row.height / 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = row.color || CARD_COLORS.primary;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_COLORS.text1;
    ctx.font = font(26);
    ctx.fillText(row.name, row.x + dotR * 2 + 12, row.y + row.height / 2 + 9);

    ctx.textAlign = 'right';
    ctx.font = font(26, 'bold');
    ctx.fillText(`¥ ${row.amount}`, row.x + row.width, row.y + row.height / 2 + 9);
  }

  // ---------- 趋势（精简模式跳过）----------
  if (layout.trendCard && layout.trendChartRect && layout.trendTitleBaseline !== null) {
    drawSectionTitle(ctx, model.trendTitle, layout.trendTitleBaseline, pad);
    fillCard(ctx, layout.trendCard);
    if (model.trend.length === 0) {
      drawChartEmpty(ctx, model.trendEmptyText, layout.trendChartRect);
    } else {
      ctx.save();
      ctx.translate(layout.trendChartRect.x, layout.trendChartRect.y);
      renderLine({
        ctx,
        w: layout.trendChartRect.width,
        h: layout.trendChartRect.height,
        points: model.trend,
        fontScale: CHART_FONT_SCALE
      });
      ctx.restore();
    }
  }

  // ---------- 行程（精简模式跳过）----------
  if (layout.mileageCard && layout.mileageChartRect && layout.mileageTitleBaseline !== null) {
    drawSectionTitle(ctx, '行程 (km)', layout.mileageTitleBaseline, pad);
    fillCard(ctx, layout.mileageCard);
    if (model.monthlyMileageEmpty) {
      drawChartEmpty(ctx, '暂无行程数据', layout.mileageChartRect);
    } else {
      ctx.save();
      ctx.translate(layout.mileageChartRect.x, layout.mileageChartRect.y);
      renderBars({
        ctx,
        w: layout.mileageChartRect.width,
        h: layout.mileageChartRect.height,
        bars: model.monthlyMileage,
        fontScale: CHART_FONT_SCALE
      });
      ctx.restore();
    }
  }

  // ---------- 费用（精简模式跳过）----------
  if (layout.costCard && layout.costChartRect && layout.costTitleBaseline !== null) {
    drawSectionTitle(ctx, '费用 (元)', layout.costTitleBaseline, pad);
    fillCard(ctx, layout.costCard);
    if (model.monthlyCostEmpty) {
      drawChartEmpty(ctx, '暂无费用数据', layout.costChartRect);
    } else {
      ctx.save();
      ctx.translate(layout.costChartRect.x, layout.costChartRect.y);
      renderBars({
        ctx,
        w: layout.costChartRect.width,
        h: layout.costChartRect.height,
        bars: model.monthlyCost,
        fontScale: CHART_FONT_SCALE
      });
      ctx.restore();
    }
  }

  // ---------- 页脚 ----------
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.font = font(22);
  ctx.fillText(opts.footerText || '车记本 · 记录每一公里', pad, layout.footerBaseline);

  if (opts.dateText) {
    ctx.textAlign = 'right';
    ctx.fillText(opts.dateText, W - pad, layout.footerBaseline);
  }

  // 底部品牌条
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, CARD_COLORS.primary);
  barGrad.addColorStop(1, CARD_COLORS.primaryDark);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, H - 12, W, 12);

  ctx.restore();
}

/** 无数据时的空态卡片：仍保留头部与结构，避免分享出全是 -- 的图 */
export function drawEmptyCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr } = opts;
  const W = layout.width;
  const H = layout.height;
  const pad = layout.padding;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = CARD_COLORS.pageBg;
  ctx.fillRect(0, 0, W, H);

  const hd = layout.header;
  const grad = ctx.createLinearGradient(0, 0, W, hd.height);
  grad.addColorStop(0, CARD_COLORS.headerTop);
  grad.addColorStop(1, CARD_COLORS.headerBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(hd.x, hd.y, hd.width, hd.height);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(40, 'bold');
  ctx.fillText(model.carName, pad, layout.titleBaseline);

  ctx.font = font(24);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${model.energyLabel} · ${model.rangeLabel}`, pad, layout.subtitleBaseline);

  ctx.textAlign = 'right';
  ctx.font = font(26, 'bold');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('车记本', W - pad, layout.titleBaseline);

  ctx.textAlign = 'center';
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.font = font(28);
  ctx.fillText('这段时间还没有记录', W / 2, hd.height + 120);
  ctx.font = font(24);
  ctx.fillText('记一笔后即可生成统计卡片', W / 2, hd.height + 168);

  ctx.font = font(22);
  ctx.fillText(opts.footerText || '车记本 · 记录每一公里', W / 2, H - 56);

  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, CARD_COLORS.primary);
  barGrad.addColorStop(1, CARD_COLORS.primaryDark);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, H - 12, W, 12);

  ctx.restore();
}

/** 空态卡片固定高度 */
export const EMPTY_CARD_HEIGHT = 560;

/** 导出画布的固定宽度 */
export const SHARE_CARD_WIDTH = CARD_WIDTH;

/**
 * 微信 canvas 单边尺寸上限（经验值 4096px）。
 * 1:1 复刻统计页后卡片逻辑高度约 3000px，若按 dpr=3 导出会到 9000px，
 * 超出上限会导致 canvasToTempFilePath 失败或导出空白图。
 */
export const MAX_CANVAS_EDGE = 4096;

/**
 * 计算安全的导出 dpr。
 * 优先保证单边不超过上限，其次才追求清晰度。
 */
export function resolveExportDpr(logicalWidth: number, logicalHeight: number, deviceDpr: number): number {
  const safe = Math.min(
    deviceDpr || 2,
    MAX_CANVAS_EDGE / Math.max(logicalWidth, logicalHeight)
  );
  // 保底 1，避免极端情况下算出 0 或负数
  return Math.max(1, Number(safe.toFixed(2)));
}
