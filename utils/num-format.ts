// 概览页「出行成本」图块的数值格式化。
//
// 图块很窄：每格可用宽度只有约 58.75px（内容 130.5px 减竖线 1px 与两侧 6px 边距，
// 再两等分）。因此需要一套「先压缩、再降字号、绝不省略」的规则。
//
// 规则（已在原型里逐档验证）：
// 1. 金额 < 10 万：完整千分位，保精度
//    金额 10 万 ~ 1 亿：用「万」，小数位按量级递减（2/1/0）
//    金额 ≥ 1 亿：用「亿」
// 2. 里程同规则，阈值同为 10 万，单位 km 永远保留
// 3. 去尾 0（12.80万 → 12.8万），尾 0 白占宽度且是溢出主因
// 4. 字号按 11.5→…→8.5 逐档试，取能放下的最大者；
//    两列取较小值统一应用，保证并排字号一致
// 5. 每公里成本单独分档，且必须拦截里程为 0 的除零

/** 图块单列可用宽度（px） */
export const CELL_WIDTH = 58.75;

/** 字号候选，从大到小 */
export const FONT_STEPS = [11.5, 11, 10.5, 10, 9.5, 9, 8.5];

/**
 * 首选字号下限：低于它说明压缩得不够，应先退到更简的数字写法，
 * 而不是继续缩小字号（10px 是这排数字的可读底线）。
 */
export const PREFERRED_MIN_FONT = 10;

/** 压缩阈值：10 万 */
export const COMPACT_THRESHOLD = 100000;

/** 亿 */
const YI = 1e8;
/** 万 */
const WAN = 1e4;

export interface FittedText {
  text: string;
  /** 该文本应使用的字号（px） */
  font: number;
}

export interface MoneyKmPair {
  moneyText: string;
  kmText: string;
  /** 两列统一使用的字号 */
  font: number;
}

/**
 * 估算文本宽度（单位 em）。
 *
 * 按 PingFang SC 粗略比例：数字 0.56em、标点 0.28em、￥ 0.95em、
 * 空格 0.28em、k 0.52em、m 0.86em、其余全角字符 1em。
 * 不调用 canvas measureText：格式化要能在纯逻辑层跑（含单测）。
 */
export function textWidthEm(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch >= '0' && ch <= '9') w += 0.56;
    else if (ch === '.' || ch === ',') w += 0.28;
    else if (ch === '￥') w += 0.95;
    else if (ch === ' ') w += 0.28;
    else if (ch === 'k') w += 0.52;
    else if (ch === 'm') w += 0.86;
    else w += 1;
  }
  return w;
}

/** 能放下该文本的最大字号；都放不下时返回最小档 */
export function fitFontSize(text: string, available = CELL_WIDTH): number {
  const em = textWidthEm(text);
  for (const size of FONT_STEPS) {
    if (em * size <= available) return size;
  }
  return FONT_STEPS[FONT_STEPS.length - 1];
}

/** 去尾 0：12.80 → 12.8，10.00 → 10 */
export function trimZero(s: string): string {
  if (s.indexOf('.') < 0) return s;
  return s.replace(/\.?0+$/, '');
}

/**
 * 四舍五入到 d 位小数。
 *
 * 不能直接用 `toFixed`：128.45 在二进制里是 128.4499…，`toFixed(1)` 会得 "128.4"。
 * 用户看到 128,450 变成 128.4 万会认为算错了，所以加一个极小偏移再取整。
 */
export function roundTo(value: number, d: number): number {
  const f = Math.pow(10, d);
  return Math.round(value * f + 1e-9) / f;
}

/**
 * 「万/亿」值的小数位：保证数字部分不超过 6 个字符。
 * < 100 用 2 位，100~999 用 1 位，≥ 1000 用 0 位。
 */
export function decimalsFor(value: number): number {
  if (value < 100) return 2;
  if (value < 1000) return 1;
  return 0;
}

/** 由「万/亿值」生成从最精确到最简的候选串（去重，避免同串出现多次） */
function compactVariants(value: number, unit: string, prefix: string): string[] {
  const out: string[] = [];
  for (let d = decimalsFor(value); d >= 0; d--) {
    const text = prefix + trimZero(roundTo(value, d).toFixed(d)) + unit;
    if (out.indexOf(text) < 0) out.push(text);
  }
  return out;
}

/**
 * 小额金额的写法：千分位 + 最多 2 位小数，去尾 0。
 *
 * 不能直接 Math.round：￥128.45 会被显示成 ￥128，与「小额保精度」的规则矛盾。
 * 记账场景里金额本来就可能带小数（停车 12.50、充电 28.45）。
 */
function amountText(n: number): string {
  const v = roundTo(n, 2);
  const whole = Math.trunc(v);
  const cents = v - whole;
  const base = thousands(whole);
  if (cents < 0.005) return base;
  // 0.45 → '.45'；0.5 → '.5'
  return base + trimZero(cents.toFixed(2)).replace(/^0/, '');
}

/** 金额候选串（含 ￥） */
export function moneyVariants(n: number): string[] {
  if (!isFinite(n) || n < 0) return ['￥--'];
  if (n < COMPACT_THRESHOLD) return ['￥' + amountText(n)];
  if (n < YI) return compactVariants(n / WAN, '万', '￥');
  return compactVariants(n / YI, '亿', '￥');
}

/** 里程候选串（含 km，单位永不丢弃） */
export function kmVariants(n: number): string[] {
  if (!isFinite(n) || n < 0) return ['-- km'];
  const v = Math.round(n);
  if (v < COMPACT_THRESHOLD) return [thousands(v) + ' km'];
  if (v < YI) return compactVariants(v / WAN, '万', '').map(s => s + ' km');
  return compactVariants(v / YI, '亿', '').map(s => s + ' km');
}

/** 千分位（整数） */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 从候选串里挑一个：优先保精度，但要求字号 ≥ PREFERRED_MIN_FONT；
 * 若最精确的写法需要更小字号，就退到下一档更简的写法。
 */
export function chooseFitted(variants: string[], available = CELL_WIDTH): FittedText {
  for (const text of variants) {
    const font = fitFontSize(text, available);
    if (font >= PREFERRED_MIN_FONT) return { text, font };
  }
  const last = variants[variants.length - 1];
  return { text: last, font: fitFontSize(last, available) };
}

/** 金额 → 文本 + 字号 */
export function formatMoneyFitted(n: number, available = CELL_WIDTH): FittedText {
  return chooseFitted(moneyVariants(n), available);
}

/** 里程 → 文本 + 字号 */
export function formatKmFitted(n: number, available = CELL_WIDTH): FittedText {
  return chooseFitted(kmVariants(n), available);
}

/**
 * 金额与里程成对格式化，两列使用**同一字号**（取较小值）。
 *
 * 为什么统一：两列宽度各自独立、不会互相挤占，但若各自算字号，
 * 会出现「左边 10.5px、右边 11.5px」，多车并排时明显不齐。
 */
export function formatMoneyKmPair(
  spend: number,
  driven: number,
  available = CELL_WIDTH
): MoneyKmPair {
  const money = formatMoneyFitted(spend, available);
  const km = formatKmFitted(driven, available);
  const font = Math.min(money.font, km.font);
  return {
    moneyText: money.text,
    kmText: km.text,
    font
  };
}

/**
 * 每公里出行成本。
 *
 * - 里程 ≤ 0（刚建档）→ `￥--`，绝不能出现 Infinity/NaN
 * - < 0.01（里程极大）→ 3 位小数，否则会显示成 0.00
 * - ≥ 10（豪车或极短里程）→ 1 位小数，并封顶 99.9 避免撑破
 * - 其余 2 位小数
 */
export function formatPerKm(spend: number, driven: number): string {
  if (!isFinite(spend) || spend < 0) return '￥--';
  if (!isFinite(driven) || driven <= 0) return '￥--';
  const v = spend / driven;
  if (!isFinite(v)) return '￥--';
  if (v < 0.01) return '￥' + v.toFixed(3);
  if (v >= 10) return '￥' + Math.min(v, 99.9).toFixed(1);
  return '￥' + v.toFixed(2);
}

/**
 * 只要文本、不做字号适配（用于图例、环图中心等有弹性宽度的地方）。
 */
export function formatCompact(n: number): string {
  if (!isFinite(n) || n < 0) return '--';
  const v = Math.round(n);
  if (v < COMPACT_THRESHOLD) return thousands(v);
  const unitValue = v < YI ? v / WAN : v / YI;
  const unit = v < YI ? '万' : '亿';
  const d = decimalsFor(unitValue);
  return trimZero(roundTo(unitValue, d).toFixed(d)) + unit;
}
