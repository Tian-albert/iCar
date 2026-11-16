// 分类 / 按车配色：数量足够、与设计令牌一致、相邻色可区分。
//
// 背景：CHART_COLORS 原本只有 6 色，而取色是 i % length，
// 第 7 辆车会与第 1 辆同色，概览页图例出现两行同色，无法对应。
import { CHART_COLORS } from '../domain/stats.service';

const fs = require('fs') as any;
const css: string = fs.readFileSync('app.wxss', 'utf-8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`app.wxss 缺少令牌 --${name}`);
  return m[1].toUpperCase();
}

/** 相对亮度（WCAG） */
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const rgb = [0, 2, 4].map(i => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/** 色相角（0~360） */
function hue(hex: string): number {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

describe('配色数量', () => {
  it('至少 8 色，且不少于常见车辆数', () => {
    expect(CHART_COLORS.length).toBeGreaterThanOrEqual(8);
    expect(CHART_COLORS.length).toBe(10);
  });

  it('全部合法 6 位 hex 且不重复', () => {
    for (const c of CHART_COLORS) {
      expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    const upper = CHART_COLORS.map(c => c.toUpperCase());
    expect(new Set(upper).size).toBe(upper.length);
  });
});

describe('与设计令牌一一对应', () => {
  it('CHART_COLORS[i] 必须等于 --chart-(i+1)', () => {
    CHART_COLORS.forEach((c, i) => {
      expect(c.toUpperCase()).toBe(token(`chart-${i + 1}`));
    });
  });

  it('app.wxss 里没有多余的 chart 色令牌', () => {
    // 防止改了 TS 忘了改 CSS（或反之），两边数量必须一致
    const declared = (css.match(/--chart-\d+:/g) || []).length;
    expect(declared).toBe(CHART_COLORS.length);
  });
});

describe('相邻色可区分', () => {
  it('相邻两项的色相角至少相差 25 度', () => {
    for (let i = 1; i < CHART_COLORS.length; i++) {
      const a = hue(CHART_COLORS[i - 1]);
      const b = hue(CHART_COLORS[i]);
      let diff = Math.abs(a - b);
      if (diff > 180) diff = 360 - diff;
      expect(diff).toBeGreaterThanOrEqual(25);
    }
  });

  it('没有两色亮度过近（避免灰度下无法区分）', () => {
    for (let i = 0; i < CHART_COLORS.length; i++) {
      for (let j = i + 1; j < CHART_COLORS.length; j++) {
        const d = Math.abs(luminance(CHART_COLORS[i]) - luminance(CHART_COLORS[j]));
        // 同色相不同明度可以接受，这里只挡「几乎一样亮 + 几乎一样色相」的组合
        const hueDiff = Math.abs(hue(CHART_COLORS[i]) - hue(CHART_COLORS[j]));
        const nearHue = hueDiff < 12 || hueDiff > 348;
        if (nearHue) expect(d).toBeGreaterThan(0.05);
      }
    }
  });
});

describe('取色不再在第 7 辆重复', () => {
  it('前 10 辆车的颜色互不相同', () => {
    const picked = Array.from({ length: 10 }, (_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    expect(new Set(picked).size).toBe(10);
  });

  it('第 11 辆才回到第 1 色（可接受的循环起点）', () => {
    expect(CHART_COLORS[10 % CHART_COLORS.length]).toBe(CHART_COLORS[0]);
  });
});
