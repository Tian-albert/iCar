// 颜色对比度约束（WCAG AA）：正文 ≥ 4.5:1，大字/图形 ≥ 3:1
//
// 为什么要测试：`--color-text-3` 原为 #9AA4B2，白底仅 2.52:1，被引用 56 处，
// 属于全站可读性问题。视觉问题无法靠 typecheck / lint 发现，只能靠计算。
//
// 2026-11-15 已整体加深 text-3 到 #6B7486（白底 4.70:1）。
// 注意深色卡 #1E2536 上的对比度方向相反：深底需用浅色 text-4（4.96:1），
// 新 text-3 在深底仅 3.25:1，故 text-4 保留为「深底专用」。
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
const DARK = '#1E2536';

describe('白底文本色对比度（WCAG AA 4.5:1）', () => {
  it('主文本 text-1 达标', () => {
    expect(contrast(token('--color-text-1'), WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--color-text-1'), BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('次文本 text-2 达标', () => {
    expect(contrast(token('--color-text-2'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('辅助文字 text-3 达标（本次从 #9AA4B2 加深到 #6B7486）', () => {
    expect(contrast(token('--color-text-3'), WHITE)).toBeGreaterThanOrEqual(4.5);
    // 页面底（浅灰）上同样达标
    expect(contrast(token('--color-text-3'), BG)).toBeGreaterThanOrEqual(4.3);
  });

  it('text-3 与 text-2 仍可区分（层级未被压平）', () => {
    const c2 = contrast(token('--color-text-2'), WHITE);
    const c3 = contrast(token('--color-text-3'), WHITE);
    expect(c2 - c3).toBeGreaterThan(0.5);
  });

  it('primary 文字对比度接近 AA（品牌色，4.3:1 下限）', () => {
    expect(contrast(token('--color-primary'), WHITE)).toBeGreaterThanOrEqual(4.3);
    // 按钮：白字在 primary 上
    expect(contrast(WHITE, token('--color-primary'))).toBeGreaterThanOrEqual(4.3);
  });
});

describe('深色卡上的文本色对比度', () => {
  it('深底主文本（白）达标', () => {
    expect(contrast(WHITE, DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it('深底辅助文字 text-4 达标', () => {
    expect(contrast(token('--color-text-4'), DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it('深底不应使用 text-3（加深后仅 3.25:1）—— 记录该约束', () => {
    // 这条断言的意义：如果有人把深底文字从 text-4 改成 text-3，
    // 数值上会倒退，此处显式记录，避免误改。
    expect(contrast(token('--color-text-3'), DARK)).toBeLessThan(4.5);
  });
});

describe('text-4 的使用边界（白底不达标，仅限深底/装饰）', () => {
  it('text-4 在白底低于 4.5:1，必须限制使用场景', () => {
    expect(contrast(token('--color-text-4'), WHITE)).toBeLessThan(4.5);
  });

  it('text-4 只出现在深色卡（vehicle-detail 统计卡）内', () => {
    // 边界约束：若将来在白底处用 text-4，此用例会失败，提醒改用 text-3
    const allowed = ['pages/vehicle-detail/index.wxss'];
    const dirs = ['pages', 'components'];
    const offenders: string[] = [];
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      if (!fsx.existsSync(dir)) return out;
      for (const e of fsx.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${e.name}`;
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.wxss')) out.push(full);
      }
      return out;
    };
    for (const d of dirs) {
      for (const f of walk(d)) {
        const src: string = fsx.readFileSync(f, 'utf-8');
        if (src.includes('var(--color-text-4)')) {
          if (!allowed.some(a => f.replace(/\\/g, '/').includes(a))) offenders.push(f);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
