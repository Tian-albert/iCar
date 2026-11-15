// renderDonut 的「无外标签」模式：概览页 100px 小环图用。
// 组件与分享卡片仍用默认 showLabels=true，行为不得改变。
import { renderDonut, computeDonutLayout } from '../utils/chart-render';

function recorder() {
  const arcs: Array<{ x: number; y: number; r: number }> = [];
  const texts: Array<{ text: string; x: number; y: number; font: string }> = [];
  const state: any = { fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 1, globalAlpha: 1 };
  const ctx: any = {
    _arcs: arcs,
    _texts: texts,
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    arc: (x: number, y: number, r: number) => arcs.push({ x, y, r }),
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    clearRect: () => {},
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, font: state.font }),
    measureText: (t: string) => ({ width: t.length * 8 }),
    createLinearGradient: () => ({ addColorStop: () => {} })
  };
  for (const k of Object.keys(state)) {
    Object.defineProperty(ctx, k, {
      get: () => state[k],
      set: (v: any) => { state[k] = v; }
    });
  }
  return ctx;
}

const SEGMENTS = [
  { name: 'CRV', amount: '4,820', percent: 55, color: '#3B82F6' },
  { name: '汉DM-i', amount: '2,340', percent: 27, color: '#22C55E' },
  { name: 'Model Y', amount: '1,560', percent: 18, color: '#F59E0B' }
];

describe('无外标签环图（概览页）', () => {
  it('showLabels=false 时只画中心两行文字，不画外标签', () => {
    const ctx = recorder();
    renderDonut({
      ctx,
      w: 104,
      h: 104,
      segments: SEGMENTS,
      total: '8,720',
      showLabels: false,
      centerLabel: '今年合计'
    });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts).toEqual(['¥8,720', '今年合计']);
    // 不应出现「车名 55.00%」这类外标签
    expect(texts.some((t: string) => t.includes('%'))).toBe(false);
  });

  it('默认（showLabels 未传）仍绘制外标签，组件行为不变', () => {
    const ctx = recorder();
    renderDonut({
      ctx,
      w: 400,
      h: 300,
      segments: SEGMENTS,
      total: '8,720'
    });

    const texts = ctx._texts.map((t: any) => t.text);
    expect(texts.some((t: string) => t.includes('%'))).toBe(true);
    // 中心仍默认「总支出」
    expect(texts).toContain('总支出');
  });

  it('centerLabel 可自定义', () => {
    const ctx = recorder();
    renderDonut({
      ctx,
      w: 104,
      h: 104,
      segments: SEGMENTS,
      total: '1,000',
      showLabels: false,
      centerLabel: '自定义文案'
    });
    expect(ctx._texts.map((t: any) => t.text)).toContain('自定义文案');
  });

  it('无标签时环更大（不为标签预留横向空间）', () => {
    const withLabels = computeDonutLayout(104, 104, 1, true);
    const noLabels = computeDonutLayout(104, 104, 1, false);
    expect(noLabels.outerR).toBeGreaterThan(withLabels.outerR);
    expect(noLabels.valid).toBe(true);
    expect(noLabels.innerR).toBeLessThan(noLabels.outerR);
  });

  it('第三参数默认值保持旧行为（withLabels 缺省为 true）', () => {
    expect(computeDonutLayout(400, 300, 1).outerR).toBe(computeDonutLayout(400, 300, 1, true).outerR);
  });

  it('扇区仍按百分比铺满整圈（累计 360°）', () => {
    const ctx = recorder();
    renderDonut({
      ctx,
      w: 104,
      h: 104,
      segments: SEGMENTS,
      total: '8,720',
      showLabels: false
    });
    // 每个扇区两次 arc（外圈 + 内圈），共 3×2
    expect(ctx._arcs.length).toBe(SEGMENTS.length * 2);
    // 只有两个半径值（外圈 / 内圈），说明每个扇区都用了同一对半径
    const radii: number[] = [...new Set<number>(ctx._arcs.map((a: any) => Math.round(a.r * 100) / 100))];
    expect(radii.length).toBe(2);
    expect(Math.max(...radii)).toBeCloseTo(computeDonutLayout(104, 104, 1, false).outerR, 5);
    expect(Math.min(...radii)).toBeCloseTo(computeDonutLayout(104, 104, 1, false).innerR, 5);
  });
});
