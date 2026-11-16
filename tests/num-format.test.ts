// 概览页数值格式化：压缩规则 + 字号回退 + 边界拦截
import {
  CELL_WIDTH,
  FONT_STEPS,
  PREFERRED_MIN_FONT,
  textWidthEm,
  fitFontSize,
  trimZero,
  decimalsFor,
  moneyVariants,
  kmVariants,
  chooseFitted,
  formatMoneyFitted,
  formatKmFitted,
  formatMoneyKmPair,
  formatPerKm,
  formatCompact,
  thousands
} from '../utils/num-format';

const EPS = 0.01;

/** 该文本在给定字号下是否放得进单列 */
function fitsInCell(text: string, font: number): boolean {
  return textWidthEm(text) * font <= CELL_WIDTH + EPS;
}

describe('基础工具', () => {
  it('千分位', () => {
    expect(thousands(46500)).toBe('46,500');
    expect(thousands(999)).toBe('999');
    expect(thousands(1234567)).toBe('1,234,567');
  });

  it('去尾 0：12.80 → 12.8，10.00 → 10', () => {
    expect(trimZero('12.80')).toBe('12.8');
    expect(trimZero('10.00')).toBe('10');
    expect(trimZero('123.5')).toBe('123.5');
    expect(trimZero('0.00')).toBe('0');
  });

  it('小数位按量级递减：<100 用 2 位、100~999 用 1 位、≥1000 用 0 位', () => {
    expect(decimalsFor(12.85)).toBe(2);
    expect(decimalsFor(99.99)).toBe(2);
    expect(decimalsFor(123.5)).toBe(1);
    expect(decimalsFor(999.9)).toBe(1);
    expect(decimalsFor(1235)).toBe(0);
  });
});

describe('金额压缩', () => {
  it('小于 10 万保完整精度（记账场景要准确值）', () => {
    expect(moneyVariants(28450)[0]).toBe('￥28,450');
    expect(moneyVariants(99999)[0]).toBe('￥99,999');
    expect(moneyVariants(0)[0]).toBe('￥0');
  });

  it('10 万起用「万」，1 亿起用「亿」', () => {
    expect(moneyVariants(128450)[0]).toBe('￥12.85万');
    expect(moneyVariants(1284500)[0]).toBe('￥128.5万');
    expect(moneyVariants(12345000)[0]).toBe('￥1235万');
    expect(moneyVariants(128000000)[0]).toBe('￥1.28亿');
  });

  it('候选串从精确到最简，去尾 0 后不出现 12.80 这类多余小数', () => {
    const vs = moneyVariants(128040);
    expect(vs).toEqual(['￥12.8万', '￥13万']);
    expect(vs.every(v => v.indexOf('.80') < 0)).toBe(true);
  });

  it('负数与非法值显示占位符，不产生 NaN', () => {
    expect(moneyVariants(-1)[0]).toBe('￥--');
    expect(moneyVariants(NaN)[0]).toBe('￥--');
  });
});

describe('里程压缩', () => {
  it('小于 10 万保完整精度，且带 km', () => {
    expect(kmVariants(46500)[0]).toBe('46,500 km');
    expect(kmVariants(99999)[0]).toBe('99,999 km');
  });

  it('10 万起用「万」，单位 km 永不丢弃', () => {
    expect(kmVariants(123500)[0]).toBe('12.35万 km');
    expect(kmVariants(1234500)[0]).toBe('123.5万 km');
    expect(kmVariants(12345000)[0]).toBe('1235万 km');
  });

  it('所有候选串都以 km 结尾', () => {
    [0, 46500, 123500, 1234500, 12345000, 1e9].forEach(n => {
      kmVariants(n).forEach(v => {
        expect(v.endsWith(' km')).toBe(true);
      });
    });
  });
});

describe('字号回退：任何量级都不溢出、都带单位', () => {
  // 覆盖从 0 到万亿的量级
  const CASES = [
    0, 1, 999, 46500, 99999,
    100000, 123500, 456800, 999900,
    1234500, 9876500, 12345000,
    99999999, 100000000, 1234567890, 1e12
  ];

  it('金额：文本宽度 × 字号 始终不超过单列宽度', () => {
    CASES.forEach(n => {
      const f = formatMoneyFitted(n);
      expect(fitsInCell(f.text, f.font)).toBe(true);
    });
  });

  it('里程：同样不溢出，且一定带 km', () => {
    CASES.forEach(n => {
      const f = formatKmFitted(n);
      expect(fitsInCell(f.text, f.font)).toBe(true);
      expect(f.text.endsWith(' km')).toBe(true);
    });
  });

  it('字号只从候选档里取，不会产生奇怪的小数', () => {
    CASES.forEach(n => {
      expect(FONT_STEPS.indexOf(formatMoneyFitted(n).font)).toBeGreaterThanOrEqual(0);
      expect(FONT_STEPS.indexOf(formatKmFitted(n).font)).toBeGreaterThanOrEqual(0);
    });
  });

  it('优先保精度：能放下就不降字号到可读下限以下', () => {
    // 46,500 km 在 11.5px 下放得下，不该被降字号
    expect(formatKmFitted(46500).font).toBeGreaterThanOrEqual(PREFERRED_MIN_FONT);
    // 28,450 同理
    expect(formatMoneyFitted(28450).font).toBeGreaterThanOrEqual(PREFERRED_MIN_FONT);
  });

  it('极端值才允许降到可读下限以下（8.5 档仅作保险）', () => {
    const f = formatKmFitted(1e12);
    expect(FONT_STEPS).toContain(f.font);
    expect(fitsInCell(f.text, f.font)).toBe(true);
  });
});

describe('两列统一字号', () => {
  it('金额与里程都用较小字号，保证并排一致', () => {
    const cases: Array<[number, number]> = [
      [28450, 46500],
      [1284500, 1234500],
      [999900, 999900],
      [12345000, 12345000],
      [9876500, 123500],
      [128450, 123500]
    ];

    cases.forEach(([spend, driven]) => {
      const pair = formatMoneyKmPair(spend, driven);
      const moneyFont = formatMoneyFitted(spend).font;
      const kmFont = formatKmFitted(driven).font;
      expect(pair.font).toBe(Math.min(moneyFont, kmFont));
      // 统一字号必须对两列都成立（否则就溢出了）
      expect(fitsInCell(pair.moneyText, pair.font)).toBe(true);
      expect(fitsInCell(pair.kmText, pair.font)).toBe(true);
    });
  });

  it('常规数据不触发降字号', () => {
    const pair = formatMoneyKmPair(28450, 46500);
    expect(pair.font).toBe(FONT_STEPS[0]);
  });
});

describe('每公里出行成本', () => {
  it('常规保留 2 位小数', () => {
    expect(formatPerKm(28450, 46500)).toBe('￥0.61');
    expect(formatPerKm(16340, 33800)).toBe('￥0.48');
  });

  it('里程为 0 时显示占位符，绝不出现 Infinity / NaN', () => {
    expect(formatPerKm(28450, 0)).toBe('￥--');
    expect(formatPerKm(0, 0)).toBe('￥--');
    expect(formatPerKm(100, -5)).toBe('￥--');
  });

  it('极小的每公里成本保留 3 位，避免显示成 0.00', () => {
    expect(formatPerKm(100, 100000)).toBe('￥0.001');
    expect(formatPerKm(500, 200000)).toBe('￥0.003');
  });

  it('≥10 时用 1 位小数，并封顶 99.9', () => {
    expect(formatPerKm(120000, 10000)).toBe('￥12.0');
    expect(formatPerKm(1e9, 1000)).toBe('￥99.9');
  });
});

describe('formatCompact（图例与环图中心用）', () => {
  it('小数据完整千分位，10 万起用万', () => {
    expect(formatCompact(8720)).toBe('8,720');
    expect(formatCompact(99999)).toBe('99,999');
    expect(formatCompact(128450)).toBe('12.85万');
    expect(formatCompact(128000000)).toBe('1.28亿');
  });

  it('非法值降级为占位符', () => {
    expect(formatCompact(-1)).toBe('--');
    expect(formatCompact(NaN)).toBe('--');
  });
});

describe('宽度估算本身', () => {
  it('￥ 与全角字符比数字宽', () => {
    expect(textWidthEm('￥')).toBeGreaterThan(textWidthEm('8'));
    expect(textWidthEm('万')).toBeGreaterThan(textWidthEm('.'));
  });

  it('fitFontSize 在放不下时返回最小档，不返回 0 或负数', () => {
    const huge = '12345678901234567890';
    const f = fitFontSize(huge);
    expect(f).toBe(FONT_STEPS[FONT_STEPS.length - 1]);
    expect(f).toBeGreaterThan(0);
  });

  it('chooseFitted 总能给出可用的文本与字号', () => {
    const f = chooseFitted(['极长极长极长极长的文本', '短']);
    expect(f.text).toBeTruthy();
    expect(FONT_STEPS).toContain(f.font);
  });
});
