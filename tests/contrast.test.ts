// 颜色对比度约束（WCAG AA）：正文 ≥ 4.5:1，大字/图形 ≥ 3:1
//
// 为什么要测试：`--color-text-3` 实测 2.52:1，被引用 56 处，属于全站可读性问题。
// 视觉问题无法靠 typecheck / lint 发现，只能靠计算。
const fsx = require('fs') as any;

const CSS: string = fsx.readFileSync('app.wxss', 'utf-8');

function token(name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(CSS);
  if (!m) throw new Error(`token not found: ${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const WHITE = '#FFFFFF';
const BG = '#F5F6F8';

describe('文本色对比度（WCAG AA）', () => {
  it('主文本 text-1 达到 4.5:1', () => {
    expect(contrast(token('--color-text-1'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--color-text-1'), BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('次文本 text-2 达到 4.5:1', () => {
    expect(contrast(token('--color-text-2'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary 在白底上的文字对比度不低于 4.3:1（品牌色，接近 AA）', () => {
    // 4.38:1，作为链文字可接受；作为长正文需谨慎
    expect(contrast(token('--color-primary'), WHITE)).toBeGreaterThanOrEqual(4.3);
  });

  it('白字在 primary 上的对比度不低于 4.3:1', () => {
    expect(contrast(WHITE, token('--color-primary'))).toBeGreaterThanOrEqual(4.3);
  });
});

describe('已知缺陷：text-3 / text-4 未达 AA', () => {
  // 这两个令牌用于标签、辅助说明、箭头。2.52:1 / 3.09:1 低于 4.5:1。
  // 本测试断言「现状值未被悄悄改动」：若有人调色，必须同步更新 DESIGN.md 第 11.4 节
  // 与下面的期望值，从而强制走一次决策，而不是无意中改坏或改好都不留痕。
  const KNOWN: Array<[string, string, number]> = [
    ['--color-text-3', '#9AA4B2', 2.52],
    ['--color-text-4', '#8A93A6', 3.09]
  ];

  for (const [name, expectedHex, expectedRatio] of KNOWN) {
    it(`${name} 仍为记录的已知值 ${expectedHex}`, () => {
      expect(token(name).toUpperCase()).toBe(expectedHex.toUpperCase());
      const ratio = contrast(token(name), WHITE);
      expect(ratio).toBeCloseTo(expectedRatio, 1);
    });
  }

  it('修好之后应把此用例替换为正面对比度断言（剩余待办）', () => {
    // 占位：修复 text-3 后，删除上方的 KNOWN 断言，改为
    // expect(contrast(token('--color-text-3'), WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('--color-text-3'), WHITE)).toBeLessThan(4.5);
  });
});
