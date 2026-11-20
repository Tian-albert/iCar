// 环图中心文字的两种口径
//
// 默认（花费按车 / 分类支出）：中心是「¥12,026」+ 小字「总支出」；
// 概览的保养环图：中心是计数「1 / 6」，既不能带 ¥，也不该出现「总支出」。
import { renderDonut, DonutSegment } from '../utils/chart-render';

function fakeCtx(): { ctx: any; texts: string[] } {
  const texts: string[] = [];
  const ctx: any = {
    fillText: (t: string) => {
      texts.push(t);
    },
    // renderDonut 会调用的空实现
    beginPath: () => {},
    moveTo: () => {},
    arc: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    setLineDash: () => {},
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1
  };
  return { ctx, texts };
}

const SEGMENTS: DonutSegment[] = [
  { name: '已超期', amount: '1 项', percent: 17, color: '#F5474F' },
  { name: '临近到期', amount: '2 项', percent: 33, color: '#E8912A' },
  { name: '正常', amount: '3 项', percent: 50, color: '#B6BCC8' }
];

describe('环图中心文字', () => {
  it('默认：金额带 ¥，下方是「总支出」', () => {
    const { ctx, texts } = fakeCtx();
    renderDonut({ ctx, w: 300, h: 300, segments: SEGMENTS, total: '12,026', showLabels: false });
    expect(texts).toContain('¥12,026');
    expect(texts).toContain('总支出');
  });

  it('计数场景：withCurrency=false + centerLabel="" → 只有「1 / 6」', () => {
    const { ctx, texts } = fakeCtx();
    renderDonut({
      ctx,
      w: 300,
      h: 300,
      segments: SEGMENTS,
      total: '1 / 6',
      showLabels: false,
      withCurrency: false,
      centerLabel: ''
    });
    expect(texts).toContain('1 / 6');
    expect(texts.some(t => t.includes('¥'))).toBe(false);
    expect(texts).not.toContain('总支出');
  });
});
