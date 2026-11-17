// 统计页分享卡片：Canvas 绘制（三套视觉风格）
//
// 图表部分直接调用 utils/chart-render 的 renderDonut / renderLine / renderBars，
// 与页面上三个组件共用同一份算法 —— 保证图表形态不漂移。
//
// Canvas 2D 不解析 CSS 变量，三套风格的色板在这里以常量表镜像，
// 语义与 app.wxss / docs/DESIGN.md 的令牌保持一致。
import { CHART_THEME } from './chart-draw';
import { renderDonut, renderLine, renderBars } from './chart-render';
import { MAX_EV_CONSUMPTION } from '../domain/fuel.service';
import {
  ShareCardLayout,
  ShareCardModel,
  ShareCategoryRow,
  ShareStyle,
  CHART_FONT_SCALE,
  Rect
} from './share-card';

/** 一套分享卡主题：三处区域（头部 / 主体 / 页脚）的底色与文字色 */
export interface CardTheme {
  pageBg: string;
  cardBg: string;
  text1: string;
  text2: string;
  text3: string;
  divider: string;
  fill: string;
  grid: string;
  /** 图表主色（折线/柱状）——与 UI 强调色分开，数据图保持可读的蓝 */
  chartPrimary: string;
  /** 头部 */
  headerBg: string;
  headerInk: string;
  headerSub: string;
  /** 页脚 */
  footerBg: string;
  footerInk: string;
  footerSub: string;
  /** 头部装饰线稿（公路）的颜色 */
  sketch: string;
}

export const SHARE_THEMES: Record<ShareStyle, CardTheme> = {
  // A 极简线稿：纯白 + 黑字 + 细线，只靠留白和字重拉层级
  a: {
    pageBg: '#FFFFFF',
    cardBg: '#FFFFFF',
    text1: '#11151C',
    text2: '#5A6272',
    text3: '#8A93A6',
    divider: '#EEF0F4',
    fill: '#F2F3F5',
    grid: '#EEF0F4',
    chartPrimary: '#3B6FF6',
    headerBg: '#FFFFFF',
    headerInk: '#11151C',
    headerSub: '#8A93A6',
    footerBg: '#FFFFFF',
    footerInk: '#11151C',
    footerSub: '#8A93A6',
    sketch: '#C9D0DB'
  },
  // B 杂志封面：暖米白纸感 + 近黑 + 米色细线，强调色是陶土红
  b: {
    pageBg: '#F7F5F0',
    cardBg: '#FFFFFF',
    text1: '#161616',
    text2: '#5C574C',
    text3: '#9A9384',
    divider: '#E6E0D4',
    fill: '#EDE9E0',
    grid: '#E6E0D4',
    chartPrimary: '#3B6FF6',
    headerBg: '#F7F5F0',
    headerInk: '#161616',
    headerSub: '#9A9384',
    footerBg: '#F7F5F0',
    footerInk: '#161616',
    footerSub: '#9A9384',
    sketch: '#CFC8B8'
  },
  // C 深色运动：近黑底 + 深灰卡 + 提亮蓝（深色底上 #3B6FF6 对比度不够）
  c: {
    pageBg: '#0E1116',
    cardBg: '#161B22',
    text1: '#FFFFFF',
    text2: '#B6BECD',
    text3: '#8A93A6',
    divider: 'rgba(255,255,255,0.12)',
    fill: 'rgba(255,255,255,0.10)',
    grid: 'rgba(255,255,255,0.10)',
    chartPrimary: '#5B8CFF',
    headerBg: '#0E1116',
    headerInk: '#FFFFFF',
    headerSub: '#8A93A6',
    footerBg: '#0E1116',
    footerInk: '#FFFFFF',
    footerSub: '#8A93A6',
    sketch: 'rgba(255,255,255,0.18)'
  }
};

/** 兼容旧引用：默认（A 风格）的关键色 */
export const CARD_COLORS = {
  pageBg: SHARE_THEMES.a.pageBg,
  cardBg: SHARE_THEMES.a.cardBg,
  primary: CHART_THEME.primary,
  primaryDark: CHART_THEME.primaryDark,
  text1: SHARE_THEMES.a.text1,
  text2: SHARE_THEMES.a.text2,
  text3: SHARE_THEMES.a.text3,
  label: CHART_THEME.label,
  grid: SHARE_THEMES.a.grid,
  border: CHART_THEME.border,
  divider: SHARE_THEMES.a.divider,
  fill: SHARE_THEMES.a.fill,
  headerTop: '#1E2536',
  headerMid: '#26324E',
  headerBottom: '#2F3D60'
} as const;

/** 环形图中心文字缩放：卡片宽是页面 2.2 倍，但环本身不放大，字号单独调小 */
const DONUT_CENTER_SCALE = 1.6;

export interface DrawCardOptions {
  ctx: any;
  model: ShareCardModel;
  layout: ShareCardLayout;
  dpr: number;
  footerText?: string;
  dateText?: string;
  /** 品牌 Logo（canvas.createImage 加载后的 Image）；缺失时降级为色块 + 「车」 */
  logoImage?: any;
}

const FONT_FAMILY = 'sans-serif';
const BRAND_NAME = '车记本';
const BRAND_SUB = 'iCar · 记录每一公里';
const FOOTER_SUB = '无广告 · 无会员 · 纯本地';

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

function fillCard(ctx: any, rect: Rect, theme: CardTheme, radius = 16): void {
  ctx.fillStyle = theme.cardBg;
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fill();
  // 描边：深色主题靠细线区分卡片与背景，浅色主题靠极淡的线兜底
  ctx.strokeStyle = theme.divider;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 小节标题（左对齐） */
function drawSectionTitle(ctx: any, text: string, baseline: number, padding: number, theme: CardTheme): void {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text1;
  ctx.font = font(28, 'bold');
  ctx.fillText(text, padding, baseline);
}

/** 图表空态文案（居中） */
function drawChartEmpty(ctx: any, text: string, rect: Rect, theme: CardTheme): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.text3;
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

/** 品牌 Logo：图片优先，失败降级为蓝块 + 「车」 */
function drawLogo(ctx: any, x: number, y: number, size: number, logoImage: any): void {
  const radius = size * 0.25;
  if (logoImage && typeof ctx.drawImage === 'function') {
    ctx.save();
    roundRectPath(ctx, x, y, size, size, radius);
    ctx.clip();
    ctx.drawImage(logoImage, x, y, size, size);
    ctx.restore();
    return;
  }
  ctx.fillStyle = '#3B6FF6';
  roundRectPath(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(size * 0.5, 'bold');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('车', x + size / 2, y + size / 2 + 1);
}

/**
 * 公路线稿（A 风格的头部装饰）。
 * 一条地平线 + 两条透视边线 + 四段由近及远递减的中线虚线。
 */
function drawRoadSketch(ctx: any, x: number, y: number, w: number, h: number, color: string): void {
  const sx = w / 200;
  const sy = h / 130;
  const px = (v: number) => x + v * sx;
  const py = (v: number) => y + v * sy;

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 2.2 * Math.min(sx, sy));
  ctx.lineCap = 'round';

  // 地平线（更淡）
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(px(4), py(40));
  ctx.lineTo(px(196), py(40));
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 两条透视边线
  ctx.beginPath();
  ctx.moveTo(px(16), py(126));
  ctx.lineTo(px(86), py(40));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px(184), py(126));
  ctx.lineTo(px(114), py(40));
  ctx.stroke();

  // 中线虚线：近长远短，制造纵深
  const dashes: Array<[number, number]> = [
    [118, 104],
    [92, 80],
    [68, 59],
    [50, 44]
  ];
  for (const [y1, y2] of dashes) {
    ctx.beginPath();
    ctx.moveTo(px(100), py(y1));
    ctx.lineTo(px(100), py(y2));
    ctx.stroke();
  }
}

/** A 极简线稿头部：品牌行 → 大数字 → 每公里 → 车名 → 车型 + 右上公路 */
function drawHeaderA(
  ctx: any,
  model: ShareCardModel,
  layout: ShareCardLayout,
  logoImage: any,
  theme: CardTheme
): void {
  const W = layout.width;
  const pad = layout.padding;
  const hd = layout.header;

  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, W, hd.height);

  // 右上公路线稿
  const roadW = 206;
  const roadH = 116;
  drawRoadSketch(ctx, W - pad - roadW, hd.height - 62 - roadH, roadW, roadH, theme.sketch);

  // 顶行：品牌 / 维度
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(20, 'bold');
  ctx.fillText(`${BRAND_NAME} · ICAR`, pad, layout.brandBaseline);

  ctx.textAlign = 'right';
  ctx.font = font(20);
  ctx.fillText(model.rangeLabel, W - pad, layout.brandBaseline);

  // 大数字
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(26, 'bold');
  ctx.fillText('¥', pad, layout.heroBaseline);
  const yenW = ctx.measureText('¥').width;
  ctx.font = font(56, 'bold');
  ctx.fillText(model.heroTotal, pad + yenW + 2, layout.heroBaseline);

  // 每公里
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(16);
  ctx.fillText(`每公里 ¥${model.heroPerKm}`, pad, layout.heroBaseline + 22);

  // 车名 / 车型
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(36, 'bold');
  ctx.fillText(model.carName, pad, layout.titleBaseline);
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(15);
  ctx.fillText(`${model.energyLabel}车 · ${model.rangeLabel}`, pad, layout.subtitleBaseline);
}

/** B 杂志封面头部：刊头 → 超大数字 → 细线 → 总支出行 → 车名 */
function drawHeaderB(
  ctx: any,
  model: ShareCardModel,
  layout: ShareCardLayout,
  logoImage: any,
  theme: CardTheme
): void {
  const W = layout.width;
  const pad = layout.padding;
  const hd = layout.header;

  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, W, hd.height);

  // 刊头
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(18, 'bold');
  ctx.fillText('CAR JOURNAL', pad, layout.brandBaseline);
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(22, 'bold');
  ctx.fillText(`${BRAND_NAME} · ICAR`, pad, layout.brandBaseline + 26);

  drawLogo(ctx, W - pad - 56, 30, 56, logoImage);

  // 超大数字
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(30, 'bold');
  ctx.fillText('¥', pad, layout.heroBaseline);
  const yenW = ctx.measureText('¥').width;
  ctx.font = font(88, 'bold');
  ctx.fillText(model.heroTotal, pad + yenW + 10, layout.heroBaseline);

  // 竖排刊头字（右侧）
  ctx.save();
  ctx.translate(W - pad - 6, layout.heroBaseline - 120);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(16);
  ctx.fillText(`TOTAL COST ${model.rangeLabel}`, 0, 0);
  ctx.restore();

  // 细黑线 + 总支出 / 每公里
  const ruleY = layout.heroBaseline + 26;
  ctx.strokeStyle = theme.headerInk;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, ruleY);
  ctx.lineTo(W - pad, ruleY);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(18, 'bold');
  ctx.fillText('总支出', pad, ruleY + 30);
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(18);
  ctx.fillText(`每公里 ¥${model.heroPerKm}`, W - pad, ruleY + 30);

  // 车名
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(44, 'bold');
  ctx.fillText(model.carName, pad, layout.titleBaseline);
}

/** C 深色运动头部：品牌行 → 大写车名 → 车型 → 大数字 + 蓝色斜切 */
function drawHeaderC(
  ctx: any,
  model: ShareCardModel,
  layout: ShareCardLayout,
  logoImage: any,
  theme: CardTheme
): void {
  const W = layout.width;
  const pad = layout.padding;
  const hd = layout.header;

  ctx.fillStyle = theme.headerBg;
  ctx.fillRect(0, 0, W, hd.height);

  // 蓝色斜切光带（两条，一实一虚）
  ctx.save();
  ctx.fillStyle = '#3B6FF6';
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(W - 60, 0);
  ctx.lineTo(W + 40, 0);
  ctx.lineTo(W + 40, hd.height);
  ctx.lineTo(W - 190, hd.height);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.moveTo(W - 250, 0);
  ctx.lineTo(W - 200, 0);
  ctx.lineTo(W - 300, hd.height);
  ctx.lineTo(W - 350, hd.height);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();

  drawLogo(ctx, pad, 30, 40, logoImage);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(20, 'bold');
  ctx.fillText(BRAND_NAME, pad + 52, layout.brandBaseline);

  // 维度胶囊
  ctx.font = font(16);
  const pillW = ctx.measureText(model.rangeLabel).width + 28;
  const pillX = W - pad - pillW;
  const pillY = layout.brandBaseline - 20;
  ctx.strokeStyle = theme.divider;
  ctx.lineWidth = 1;
  roundRectPath(ctx, pillX, pillY, pillW, 32, 4);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = theme.headerSub;
  ctx.fillText(model.rangeLabel, pillX + pillW / 2, layout.brandBaseline + 5);

  // 大写车名 + 车型
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(44, 'bold');
  ctx.fillText(model.carName.toUpperCase(), pad, layout.titleBaseline);
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(16);
  ctx.fillText(`${model.energyLabel}车 · ${model.rangeLabel}统计`, pad, layout.subtitleBaseline);

  // 大数字 + 右侧标签
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(28, 'bold');
  ctx.fillText('¥', pad, layout.heroBaseline);
  const yenW = ctx.measureText('¥').width;
  ctx.fillStyle = '#6E8BFF';
  ctx.font = font(64, 'bold');
  ctx.fillText(model.heroTotal, pad + yenW + 2, layout.heroBaseline);

  ctx.textAlign = 'right';
  ctx.fillStyle = theme.headerSub;
  ctx.font = font(15);
  ctx.fillText('总支出', W - pad, layout.heroBaseline - 26);
  ctx.fillStyle = theme.headerInk;
  ctx.font = font(18, 'bold');
  ctx.fillText(`每公里 ¥${model.heroPerKm}`, W - pad, layout.heroBaseline);
}

function drawHeader(
  ctx: any,
  model: ShareCardModel,
  layout: ShareCardLayout,
  logoImage: any,
  theme: CardTheme
): void {
  if (model.style === 'b') return drawHeaderB(ctx, model, layout, logoImage, theme);
  if (model.style === 'c') return drawHeaderC(ctx, model, layout, logoImage, theme);
  return drawHeaderA(ctx, model, layout, logoImage, theme);
}

/** 指标卡：数值 + 标签，列间细分隔线 */
function drawMetricGroups(ctx: any, layout: ShareCardLayout, theme: CardTheme): void {
  for (const group of layout.groupRects) {
    fillCard(ctx, group.rect, theme);
    for (let i = 0; i < group.metrics.length; i++) {
      const m = group.metrics[i];
      const cx = m.x + m.width / 2;

      // 列分隔线（首列左侧不画）
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y + 24);
        ctx.lineTo(m.x, m.y + m.height - 24);
        ctx.strokeStyle = theme.divider;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = theme.text1;
      ctx.font = font(30, 'bold');
      ctx.fillText(m.value, cx, m.y + 50);

      ctx.fillStyle = theme.text3;
      ctx.font = font(12);
      ctx.fillText(m.label, cx, m.y + 76);
    }
  }
}

/**
 * 占比条宽度：按真实百分比换算，并设最小宽度。
 *
 * - 小占比（1~2%）若按比例画只有 1~2px，看起来像「没有这一项」，因此保底 3px；
 * - 脏数据（NaN / 负数 / >100）在这里夹到 [0,100]，避免画出负宽或超宽条。
 */
export function categoryBarWidth(trackW: number, percent: number): number {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.max(3, (trackW * pct) / 100);
}

/** 分类明细一行：色点 + 名称 + 占比条 + 金额 + 百分比 */
function drawCategoryRow(ctx: any, row: ShareCategoryRow & Rect, theme: CardTheme): void {
  const centerY = row.y + row.height / 2;
  const dotR = 6;
  const dotX = row.x + dotR;
  const nameX = row.x + 22;
  const nameW = 110;
  const pctW = 56;
  const amountW = 118;
  const trackH = 10;

  // 色点
  ctx.beginPath();
  ctx.arc(dotX, centerY, dotR, 0, Math.PI * 2);
  ctx.fillStyle = row.color || theme.chartPrimary;
  ctx.fill();

  // 名称
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.text1;
  ctx.font = font(15);
  ctx.fillText(row.name, nameX, centerY + 1);

  // 占比条：轨道 + 按真实百分比填充（与页面 .cat-bar 同语义）
  const trackX = nameX + nameW + 14;
  const trackRight = row.x + row.width - pctW - amountW - 12;
  const trackW = Math.max(10, trackRight - trackX);
  const trackY = centerY - trackH / 2;

  ctx.fillStyle = theme.fill;
  roundRectPath(ctx, trackX, trackY, trackW, trackH, trackH / 2);
  ctx.fill();

  const barW = categoryBarWidth(trackW, row.percentValue);
  ctx.fillStyle = row.color || theme.chartPrimary;
  roundRectPath(ctx, trackX, trackY, barW, trackH, trackH / 2);
  ctx.fill();

  // 金额 / 百分比
  ctx.textAlign = 'right';
  ctx.fillStyle = theme.text1;
  ctx.font = font(15, 'bold');
  ctx.fillText(`¥ ${row.amount}`, row.x + row.width - pctW - 8, centerY + 1);

  ctx.fillStyle = theme.text3;
  ctx.font = font(12);
  ctx.fillText(`${row.percentValue.toFixed(1)}%`, row.x + row.width, centerY + 1);
}

/** 页脚：slogan + 卖点 + 日期 + 二维码占位（按风格换底色与线框） */
function drawFooter(
  ctx: any,
  layout: ShareCardLayout,
  theme: CardTheme,
  footerText: string,
  dateText?: string
): void {
  const W = layout.width;
  const pad = layout.padding;
  const f = layout.footerRect;

  ctx.fillStyle = theme.footerBg;
  ctx.fillRect(f.x, f.y, f.width, f.height);

  // 顶部细线（深色主题用弱线，浅色主题同样靠细线收边）
  ctx.strokeStyle = theme.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(f.x, f.y);
  ctx.lineTo(f.x + f.width, f.y);
  ctx.stroke();

  const isDark = theme === SHARE_THEMES.c;

  // C 风格在 slogan 前加一个品牌蓝点
  let textX = pad;
  if (isDark) {
    ctx.beginPath();
    ctx.arc(pad + 5, layout.footerBaseline - 10, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#3B6FF6';
    ctx.fill();
    textX = pad + 18;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.footerInk;
  ctx.font = font(26, 'bold');
  ctx.fillText(footerText, textX, layout.footerBaseline);

  ctx.fillStyle = theme.footerSub;
  ctx.font = font(18);
  ctx.fillText(FOOTER_SUB, pad, layout.footerBaseline + 24);

  if (dateText) {
    ctx.fillStyle = theme.footerSub;
    ctx.font = font(16);
    ctx.fillText(dateText, pad, layout.footerBaseline + 46);
  }

  // 二维码占位
  const qrSize = 64;
  const qrX = W - pad - qrSize;
  const qrY = f.y + (f.height - qrSize) / 2;

  const isDarkFooter = isDark;
  if (isDarkFooter) {
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, qrX, qrY, qrSize, qrSize, 8);
    ctx.fill();
  } else {
    ctx.strokeStyle = theme.footerInk;
    ctx.lineWidth = 1;
    roundRectPath(ctx, qrX, qrY, qrSize, qrSize, 8);
    ctx.stroke();
  }

  ctx.fillStyle = isDarkFooter ? '#0E1116' : theme.footerInk;
  ctx.font = font(28);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▦', qrX + qrSize / 2, qrY + 25);

  ctx.fillStyle = isDarkFooter ? '#5A6272' : theme.footerSub;
  ctx.font = font(11);
  ctx.fillText('扫码体验', qrX + qrSize / 2, qrY + 47);
}

/**
 * 绘制整张分享卡片。
 * 画布物理尺寸由调用方按 dpr 预设，本函数内部只做一次 scale。
 */
export function drawShareCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr, logoImage } = opts;
  const theme = SHARE_THEMES[model.style] || SHARE_THEMES.a;
  const W = layout.width;
  const H = layout.height;
  const pad = layout.padding;

  ctx.save();
  ctx.scale(dpr, dpr);

  // ---------- 页面底 ----------
  ctx.fillStyle = theme.pageBg;
  ctx.fillRect(0, 0, W, H);

  // ---------- 头部 ----------
  drawHeader(ctx, model, layout, logoImage, theme);

  // ---------- 指标卡组 ----------
  drawMetricGroups(ctx, layout, theme);

  // ---------- 分类支出 ----------
  drawSectionTitle(ctx, '分类支出', layout.categoryTitleBaseline, pad, theme);
  // 右侧总支出
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(22);
  ctx.fillStyle = theme.text2;
  ctx.fillText(`总支出 ¥${model.categoryTotal}`, W - pad, layout.categoryTitleBaseline);

  fillCard(ctx, layout.categoryCard, theme);

  if (model.categories.length === 0) {
    drawChartEmpty(ctx, '暂无支出数据，记一笔后即可查看分类占比', layout.donutRect, theme);
  } else {
    // 环形图：与页面组件同一算法；去掉外标签，占比交给下方比例条
    ctx.save();
    ctx.translate(layout.donutRect.x, layout.donutRect.y);
    renderDonut({
      ctx,
      w: layout.donutRect.width,
      h: layout.donutRect.height,
      segments: model.categories.map(c => ({
        name: c.name,
        amount: c.amount,
        percent: c.percentValue,
        color: c.color
      })),
      total: model.categoryTotal,
      fontScale: DONUT_CENTER_SCALE,
      showLabels: false,
      // 深色主题下环心的金额/标签要换成浅色，否则在白卡片式的深色卡上看不见
      ink: { text1: theme.text1, text3: theme.text3, card: theme.cardBg }
    });
    ctx.restore();
  }

  // 分类明细列表（含占比条）
  for (const row of layout.categoryRowRects) {
    drawCategoryRow(ctx, row as any, theme);
  }

  // 明细被截断时明确提示，否则用户会发现金额合计对不上「总支出」
  if (model.categoryHiddenCount > 0 && layout.categoryRowRects.length > 0) {
    const lastRow = layout.categoryRowRects[layout.categoryRowRects.length - 1];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = theme.text3;
    ctx.font = font(22);
    ctx.fillText(
      `另有 ${model.categoryHiddenCount} 项未显示，合计见上方总支出`,
      lastRow.x,
      lastRow.y + lastRow.height + 26
    );
  }

  // 图表统一的颜色注入
  const chartInk = {
    grid: theme.grid,
    text3: theme.text3,
    text1: theme.text1,
    primary: theme.chartPrimary,
    primaryDark: theme.chartPrimary,
    card: theme.cardBg
  };

  // ---------- 趋势（精简模式跳过）----------
  if (layout.trendCard && layout.trendChartRect && layout.trendTitleBaseline !== null) {
    drawSectionTitle(ctx, model.trendTitle, layout.trendTitleBaseline, pad, theme);
    fillCard(ctx, layout.trendCard, theme);
    if (model.trend.length === 0) {
      drawChartEmpty(ctx, model.trendEmptyText, layout.trendChartRect, theme);
    } else {
      ctx.save();
      ctx.translate(layout.trendChartRect.x, layout.trendChartRect.y);
      renderLine({
        ctx,
        w: layout.trendChartRect.width,
        h: layout.trendChartRect.height,
        points: model.trend,
        fontScale: CHART_FONT_SCALE,
        ink: chartInk,
        // 电耗允许到 50，不能用油耗的 30 封顶
        ceiling: model.trendUnit.indexOf('kWh') >= 0 ? MAX_EV_CONSUMPTION : undefined
      });
      ctx.restore();
    }
  }

  // ---------- 行程（精简模式跳过）----------
  if (layout.mileageCard && layout.mileageChartRect && layout.mileageTitleBaseline !== null) {
    drawSectionTitle(ctx, '行程 (km)', layout.mileageTitleBaseline, pad, theme);
    fillCard(ctx, layout.mileageCard, theme);
    if (model.monthlyMileageEmpty) {
      drawChartEmpty(ctx, '暂无行程数据', layout.mileageChartRect, theme);
    } else {
      ctx.save();
      ctx.translate(layout.mileageChartRect.x, layout.mileageChartRect.y);
      renderBars({
        ctx,
        w: layout.mileageChartRect.width,
        h: layout.mileageChartRect.height,
        bars: model.monthlyMileage,
        fontScale: CHART_FONT_SCALE,
        ink: chartInk
      });
      ctx.restore();
    }
  }

  // ---------- 费用（精简模式跳过）----------
  if (layout.costCard && layout.costChartRect && layout.costTitleBaseline !== null) {
    drawSectionTitle(ctx, '费用 (元)', layout.costTitleBaseline, pad, theme);
    fillCard(ctx, layout.costCard, theme);
    if (model.monthlyCostEmpty) {
      drawChartEmpty(ctx, '暂无费用数据', layout.costChartRect, theme);
    } else {
      ctx.save();
      ctx.translate(layout.costChartRect.x, layout.costChartRect.y);
      renderBars({
        ctx,
        w: layout.costChartRect.width,
        h: layout.costChartRect.height,
        bars: model.monthlyCost,
        fontScale: CHART_FONT_SCALE,
        ink: chartInk
      });
      ctx.restore();
    }
  }

  // ---------- 页脚 ----------
  drawFooter(ctx, layout, theme, opts.footerText || '记录每一公里', opts.dateText);

  ctx.restore();
}

/** 无数据时的空态卡片：仍保留头部与品牌，避免分享出全是 -- 的图 */
export function drawEmptyCard(opts: DrawCardOptions): void {
  const { ctx, model, layout, dpr, logoImage } = opts;
  const theme = SHARE_THEMES[model.style] || SHARE_THEMES.a;
  const W = layout.width;
  const H = layout.height;
  const pad = layout.padding;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = theme.pageBg;
  ctx.fillRect(0, 0, W, H);

  // 头部沿用当前风格
  drawHeader(ctx, model, layout, logoImage, theme);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = theme.text3;
  ctx.font = font(28);
  ctx.fillText('这段时间还没有记录', W / 2, layout.header.height + 120);
  ctx.font = font(24);
  ctx.fillText('记一笔后即可生成统计卡片', W / 2, layout.header.height + 168);

  // 空态高度固定，页脚按实际高度重算
  const footerH = layout.footerRect.height;
  const footerRect: Rect = { x: 0, y: H - footerH, width: W, height: footerH };
  drawFooter(
    ctx,
    { ...layout, footerRect, footerBaseline: footerRect.y + 34 },
    theme,
    opts.footerText || '记录每一公里',
    opts.dateText
  );

  ctx.restore();
}

/** 空态卡片固定高度 */
export const EMPTY_CARD_HEIGHT = 620;

/** 导出画布的固定宽度 */

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
  // 必须向下取整：toFixed(2) 会四舍五入放大 dpr，
  // 例如 3000 逻辑高时 4096/3000=1.3653 -> 1.37 -> 4110px 超限。
  const floored = Math.floor(safe * 100) / 100;
  // 保底 1，避免极端情况下算出 0 或负数
  return Math.max(1, floored);
}
