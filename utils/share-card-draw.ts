// 统计页分享卡片：Canvas 绘制
//
// 与 chart-draw 一样，Canvas 2D 不解析 CSS 变量，颜色统一取自 CHART_THEME。
// 绘制函数接收任意 ctx（页面内离屏 canvas 或 canvas 2d 节点均可），
// 不做任何 wx.* 调用，便于在 node 环境用假 ctx 单测。
import { CHART_THEME } from './chart-draw';
import { ShareCardLayout, ShareCardModel, CARD_WIDTH } from './share-card';

/** 卡片专用色板：与 app.wxss 的品牌色一致 */
export const CARD_COLORS = {
  /** 页面底：浅灰，衬托白色卡片 */
  pageBg: '#F5F6F8',
  cardBg: CHART_THEME.card,
  primary: CHART_THEME.primary,
  primaryDark: CHART_THEME.primaryDark,
  text1: CHART_THEME.text1,
  text3: CHART_THEME.text3,
  label: CHART_THEME.label,
  grid: CHART_THEME.grid,
  border: CHART_THEME.border,
  /** 头部深色渐变（与详情页深色统计卡一致） */
  headerTop: '#1E2536',
  headerBottom: '#2A3450'
} as const;

export interface DrawCardOptions {
  ctx: any;
  model: ShareCardModel;
  layout: ShareCardLayout;
  /** 设备像素比，用于把逻辑坐标映射到物理像素 */
  dpr: number;
  /** 页脚文案，如「车记本 · 记录每一公里」 */
  footerText?: string;
  /** 导出日期文案 */
  dateText?: string;
}

const FONT_FAMILY = 'sans-serif';

function font(size: number, weight = 'normal'): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** 画圆角矩形路径（不 fill，调用方决定填充/描边） */
function roundRectPath(ctx: any, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
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

/**
 * 绘制整张分享卡片。
 * 画布物理尺寸需由调用方按 dpr 预先设置，本函数内部只做一次 scale。
 */
export function drawShareCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr } = opts;
  const W = layout.width;
  const H = layout.height;

  ctx.save();
  ctx.scale(dpr, dpr);

  // ---------- 背景 ----------
  ctx.fillStyle = CARD_COLORS.pageBg;
  ctx.fillRect(0, 0, W, H);

  // ---------- 头部深色块 ----------
  const headerH = 168;
  const grad = ctx.createLinearGradient(0, 0, W, headerH);
  grad.addColorStop(0, CARD_COLORS.headerTop);
  grad.addColorStop(1, CARD_COLORS.headerBottom);
  ctx.fillStyle = grad;
  roundRectPath(ctx, 0, 0, W, headerH + 24, 0);
  ctx.fill();

  const pad = layout.padding;

  // 车名
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(40, 'bold');
  ctx.fillText(model.carName, pad, layout.titleBaseline);

  // 车型 + 维度
  ctx.font = font(24);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${model.energyLabel} · ${model.rangeLabel}`, pad, layout.subtitleBaseline);

  // 右上角品牌
  ctx.textAlign = 'right';
  ctx.font = font(24, 'bold');
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('车记本', W - pad, layout.titleBaseline);

  // ---------- 指标区 ----------
  for (const m of layout.metrics) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_COLORS.text3;
    ctx.font = font(22);
    ctx.fillText(m.label, m.x, m.y + 26);

    ctx.fillStyle = CARD_COLORS.text1;
    ctx.font = font(36, 'bold');
    ctx.fillText(m.value, m.x, m.y + 66);
  }

  // ---------- 分类支出 ----------
  if (layout.categoryTitleBaseline !== null) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_COLORS.text1;
    ctx.font = font(28, 'bold');
    ctx.fillText('分类支出', pad, layout.categoryTitleBaseline);

    ctx.textAlign = 'right';
    ctx.font = font(24);
    ctx.fillStyle = CARD_COLORS.text3;
    ctx.fillText(`总支出 ¥${model.expenseTotal}`, W - pad, layout.categoryTitleBaseline);
  }

  const CAT_COLORS = ['#3B6FF6', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#14B8A6'];
  layout.categories.forEach((c, i) => {
    const rowY = c.y;
    const color = CAT_COLORS[i % CAT_COLORS.length];

    // 名称
    ctx.textAlign = 'left';
    ctx.fillStyle = CARD_COLORS.text1;
    ctx.font = font(24);
    ctx.fillText(c.name, c.x, rowY + 22);

    // 金额 + 百分比（右对齐）
    ctx.textAlign = 'right';
    ctx.fillStyle = CARD_COLORS.text3;
    ctx.font = font(22);
    ctx.fillText(`¥${c.amount} · ${c.percent}`, c.x + c.barMaxWidth + 150, rowY + 22);

    // 占比条：轨道 + 填充
    const barY = rowY + 34;
    const barH = 10;
    ctx.fillStyle = CARD_COLORS.grid;
    roundRectPath(ctx, c.x, barY, c.barMaxWidth, barH, barH / 2);
    ctx.fill();

    if (c.barWidth > 0) {
      ctx.fillStyle = color;
      roundRectPath(ctx, c.x, barY, Math.max(barH, c.barWidth), barH, barH / 2);
      ctx.fill();
    }
  });

  // ---------- 页脚 ----------
  ctx.textAlign = 'left';
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.font = font(22);
  ctx.fillText(opts.footerText || '车记本 · 记录每一公里', pad, layout.footerBaseline);

  if (opts.dateText) {
    ctx.textAlign = 'right';
    ctx.fillText(opts.dateText, W - pad, layout.footerBaseline);
  }

  // ---------- 底部品牌条 ----------
  const barTop = H - 12;
  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, CARD_COLORS.primary);
  barGrad.addColorStop(1, CARD_COLORS.primaryDark);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, barTop, W, 12);

  ctx.restore();
}

/** 无数据时的空态卡片：避免分享出一张全是 -- 的图 */
export function drawEmptyCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr } = opts;
  const W = layout.width;
  const H = layout.height;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = CARD_COLORS.pageBg;
  ctx.fillRect(0, 0, W, H);

  const headerH = 168;
  const grad = ctx.createLinearGradient(0, 0, W, headerH);
  grad.addColorStop(0, CARD_COLORS.headerTop);
  grad.addColorStop(1, CARD_COLORS.headerBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, headerH);

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.font = font(40, 'bold');
  ctx.fillText(model.carName, layout.padding, layout.titleBaseline);

  ctx.font = font(24);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText(`${model.energyLabel} · ${model.rangeLabel}`, layout.padding, layout.subtitleBaseline);

  ctx.textAlign = 'center';
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.font = font(28);
  ctx.fillText('这段时间还没有记录', W / 2, headerH + 120);
  ctx.font = font(24);
  ctx.fillText('记一笔后即可生成统计卡片', W / 2, headerH + 164);

  ctx.textAlign = 'center';
  ctx.font = font(22);
  ctx.fillStyle = CARD_COLORS.text3;
  ctx.fillText(opts.footerText || '车记本 · 记录每一公里', W / 2, H - 56);

  const barGrad = ctx.createLinearGradient(0, 0, W, 0);
  barGrad.addColorStop(0, CARD_COLORS.primary);
  barGrad.addColorStop(1, CARD_COLORS.primaryDark);
  ctx.fillStyle = barGrad;
  ctx.fillRect(0, H - 12, W, 12);

  ctx.restore();
}

/** 空态卡片固定高度 */
export const EMPTY_CARD_HEIGHT = 520;

/** 导出画布的固定宽度（供页面创建 canvas 使用） */
export const SHARE_CARD_WIDTH = CARD_WIDTH;
