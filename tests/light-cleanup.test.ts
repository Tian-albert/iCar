// 审计「轻量项」清理的回归测试。
//
// 这批都是小问题，但两类值得钉住：
// 1. 数值/文本的边界（金额小数、emoji 截断、展开成实参的栈溢出）
// 2. 清理行为（死代码不再回来、置顶 id 不悬空、重算用记录自己的车）
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { setPinnedCarId, getPinnedCarId } from '../services/user.service';
import { purgeExpired } from '../services/recycle.service';
import { saveRefuel, updateRefuel, getConsumptions, listRefuels } from '../services/refuel.service';
import { listCategories } from '../services/cost.service';
import { saveCost } from '../services/cost.service';
import { buildOverview } from '../services/overview.service';
import { maxOf, minOf } from '../utils/number';
import { formatMoneyFitted, moneyVariants } from '../utils/num-format';
import { buildShareMessage } from '../utils/share';
import { layoutDonutLabels } from '../utils/chart-math';
import { drawBubble } from '../utils/chart-draw';

const fsx = require('fs') as any;
const DAY = 86400000;

function makeAdapter(): StorageAdapter {
  const map = new Map<string, unknown>();
  const like: StorageLike = {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => Array.from(map.keys())
  };
  const a = new StorageAdapter(like);
  a.rebuildIndex();
  seedPresetCategories(a);
  return a;
}

function makeCar(a: StorageAdapter, name: string) {
  return createCar(a, {
    name,
    mileages: 10000,
    initMileages: 0,
    initDate: Date.now() - 100 * DAY,
    icon: 'car',
    energyType: 'fuel',
    batteryCapacity: 0,
    maintainSoonMileage: 500,
    maintainSoonDays: 15
  } as any);
}

describe('金额：小额保留小数（原来被 Math.round 抹掉）', () => {
  it('两位小数原样保留', () => {
    expect(moneyVariants(128.45)[0]).toBe('￥128.45');
    expect(moneyVariants(12.5)[0]).toBe('￥12.5');
    expect(moneyVariants(0.61)[0]).toBe('￥0.61');
  });

  it('整数不带小数点，千分位仍在', () => {
    expect(moneyVariants(28450)[0]).toBe('￥28,450');
    expect(moneyVariants(0)[0]).toBe('￥0');
  });

  it('浮点噪声被收敛到 2 位', () => {
    // 0.1 + 0.2 = 0.30000000000000004
    expect(moneyVariants(0.1 + 0.2)[0]).toBe('￥0.3');
  });

  it('进位仍走四舍五入（128.455 → 128.46）', () => {
    expect(moneyVariants(128.455)[0]).toBe('￥128.46');
  });

  it('带小数的金额也参与字号适配，不溢出', () => {
    const fitted = formatMoneyFitted(99999.99);
    expect(fitted.text.startsWith('￥')).toBe(true);
    expect(fitted.font).toBeGreaterThan(0);
  });
});

describe('分享标题：emoji 不会被切成半个字符', () => {
  /** 是否存在孤立代理项（被切断的 emoji 会产生它） */
  const hasLoneSurrogate = (s: string): boolean =>
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(s);

  it('长车名带 emoji 时截断不断字符', () => {
    // 精心构造：SUFFIX 是 4 个字，预算 = 30 − 4 − 1 = 25，
    // 所以把 emoji 放在第 25 个 UTF-16 单元起（前面 24 个中文字）。
    // 按 UTF-16 的 slice(0, 25) 会切出孤立的高位代理，也就是乱码；
    // 按码点截断则是 24 个字 + 完整 emoji。
    const highlight = `${'我'.repeat(24)}🚗${'跑'.repeat(10)}`;
    const msg = buildShareMessage({ highlight });
    expect(hasLoneSurrogate(msg.title)).toBe(false);
    expect(msg.title).toContain('🚗');
    expect(msg.title).toContain('…');
  });

  it('标题长度不超上限', () => {
    const highlight = `🚗🚗🚗我的车已经跑了很远很远很远很远很远很远很远的路`;
    const msg = buildShareMessage({ highlight });
    // 30 个码点上限（含「｜车记本」与省略号）
    expect(Array.from(msg.title).length).toBeLessThanOrEqual(30);
  });

  it('短标题不截断，emoji 完整保留', () => {
    const msg = buildShareMessage({ highlight: '我的🚗很省心' });
    expect(msg.title).toContain('🚗');
    expect(msg.title).not.toContain('…');
  });
});

describe('maxOf / minOf：替代展开成实参', () => {
  it('忽略 NaN / Infinity / undefined', () => {
    expect(maxOf([1, NaN, 5, Infinity, 3])).toBe(5);
    expect(minOf([1, NaN, -2, Infinity, 3])).toBe(-2);
  });

  it('空数组或全脏值返回 fallback', () => {
    expect(maxOf([], 7)).toBe(7);
    expect(minOf([NaN, Infinity], 9)).toBe(9);
  });

  it('十万条也不抛 RangeError（Math.max(...) 会栈溢出）', () => {
    const big: number[] = [];
    for (let i = 0; i < 200000; i++) big.push(i % 977);
    expect(() => maxOf(big)).not.toThrow();
    expect(maxOf(big)).toBe(976);
  });

  it('口径与 Math.max 一致', () => {
    const list = [-5, 0, 3.5, -2];
    expect(maxOf(list)).toBe(Math.max(...list));
    expect(minOf(list)).toBe(Math.min(...list));
  });
});

describe('环形图标签：不会画到画布外被裁掉', () => {
  it('扇区多到放不下时，所有 y 仍夹在 [minY, maxY] 内', () => {
    const segments = Array.from({ length: 12 }, (_, i) => ({
      mid: (i / 12) * Math.PI * 2,
      percent: 100 / 12
    }));
    const minY = 8;
    const maxY = 60;
    const out = layoutDonutLabels({
      segments,
      cx: 160,
      cy: 90,
      outerR: 70,
      minY,
      maxY,
      minGap: 14,
      elbowGap: 13,
      tailGap: 4
    });
    expect(out.length).toBe(segments.length);
    out.forEach(l => {
      expect(l.y).toBeGreaterThanOrEqual(minY - 0.001);
      expect(l.y).toBeLessThanOrEqual(maxY + 0.001);
    });
  });
});

describe('气泡：随 fontScale 缩放', () => {
  function recorder() {
    const texts: Array<{ text: string; font: string }> = [];
    const state: any = { font: '', fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', lineWidth: 1 };
    const ctx: any = {
      measureText: (t: string) => ({ width: t.length * 6 }),
      fillText: (t: string) => texts.push({ text: t, font: state.font }),
      beginPath: () => undefined,
      closePath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arcTo: () => undefined,
      fill: () => undefined,
      stroke: () => undefined
    };
    Object.keys(state).forEach(k => {
      Object.defineProperty(ctx, k, { get: () => state[k], set: (v: any) => { state[k] = v; } });
    });
    return { ctx, texts };
  }

  it('scale=2 时字号按比例放大（分享卡片按 2 倍尺寸绘制）', () => {
    const a = recorder();
    drawBubble(a.ctx, { text: 'CRV', x: 100, y: 100, w: 400, h: 300, scale: 1 });
    const b = recorder();
    drawBubble(b.ctx, { text: 'CRV', x: 100, y: 100, w: 400, h: 300, scale: 2 });

    const fontOf = (s: string) => Number((s.match(/(\d+)px/) || [])[1] || 0);
    expect(fontOf(b.texts[0].font)).toBeGreaterThan(fontOf(a.texts[0].font));
  });
});

describe('图表组件：位图尺寸取整', () => {
  it('三个组件的 canvas.width/height 都做了 Math.round', () => {
    ['donut-chart', 'line-chart', 'bar-chart'].forEach(name => {
      const src: string = fsx.readFileSync(`components/${name}/index.ts`, 'utf-8');
      expect(src).toMatch(/canvas\.width = Math\.round\(/);
      expect(src).toMatch(/canvas\.height = Math\.round\(/);
    });
  });
});

describe('回收站：清理过期车辆时同步清掉置顶 id', () => {
  it('置顶的车被物理清理后，pinnedCarId 不再悬空', () => {
    const a = makeAdapter();
    const car = makeCar(a, 'A');
    setPinnedCarId(a, car.sourceId);
    expect(getPinnedCarId(a)).toBe(car.sourceId);

    // 软删并回拨到 40 天前（超过 30 天保留期）
    a.softDelete('cars', car.sourceId, 'batch-x');
    const row = a.get<any>('cars', car.sourceId);
    row.deletedAt = Date.now() - 40 * DAY;
    a.update('cars', row);

    const n = purgeExpired(a);
    expect(n).toBeGreaterThan(0);
    expect(a.get<any>('cars', car.sourceId)).toBeNull();
    expect(getPinnedCarId(a)).toBe('');
  });

  it('置顶的是别的车时不受影响', () => {
    const a = makeAdapter();
    const keep = makeCar(a, '保留');
    const gone = makeCar(a, '删掉');
    setPinnedCarId(a, keep.sourceId);

    a.softDelete('cars', gone.sourceId, 'batch-y');
    const row = a.get<any>('cars', gone.sourceId);
    row.deletedAt = Date.now() - 40 * DAY;
    a.update('cars', row);

    purgeExpired(a);
    expect(getPinnedCarId(a)).toBe(keep.sourceId);
  });
});

describe('编辑加油记录：按记录自己的车重算区间', () => {
  it('表单里的 carSourceId 与记录不一致时，原车的区间仍被重算', () => {
    const a = makeAdapter();
    const carA = makeCar(a, 'A');
    const carB = makeCar(a, 'B');

    const first = saveRefuel(a, {
      carSourceId: carA.sourceId,
      fuelDate: Date.now() - 10 * DAY,
      makeMileages: 1000,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel'
    } as any);
    const second = saveRefuel(a, {
      carSourceId: carA.sourceId,
      fuelDate: Date.now() - 5 * DAY,
      makeMileages: 2000,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel'
    } as any);

    // 40L / 1000km = 4 L/100km
    expect(getConsumptions(a, carA.sourceId)[0].fuelConsumption).toBeCloseTo(4, 6);

    // 把第二笔改成 50L，但表单里传的是 B 车
    updateRefuel(a, second.sourceId, {
      carSourceId: carB.sourceId,
      fuelDate: second.fuelDate,
      makeMileages: second.makeMileages,
      unitPrice: second.unitPrice,
      volume: 50,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel'
    } as any);

    // A 车的区间必须跟着更新成 50L / 1000km = 5
    const segs = getConsumptions(a, carA.sourceId);
    expect(segs.length).toBe(1);
    expect(segs[0].fuelConsumption).toBeCloseTo(5, 6);
    expect(listRefuels(a, carA.sourceId).length).toBe(2);
    expect(first).toBeTruthy();
  });
});

describe('概览页列表 key：用稳定 id 而不是下标', () => {
  it('最近记录带 sourceId，且新增记录后旧 key 不变', () => {
    const a = makeAdapter();
    const car = makeCar(a, 'A');
    const cat = listCategories(a)[0];

    saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 100,
      costDate: Date.now() - 2 * DAY
    } as any);
    const before = buildOverview(a, Date.now()).recent.map(r => r.sourceId);
    expect(before.length).toBe(1);
    expect(before[0]).toBeTruthy();

    saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 200,
      costDate: Date.now() - DAY
    } as any);
    const after = buildOverview(a, Date.now()).recent.map(r => r.sourceId);

    // 新记录插到最前，但旧记录的 key 必须原样保留（下标方案会整体错位）
    expect(after.length).toBe(2);
    expect(after).toContain(before[0]);
  });

  it('概览不再逐条列保养项（改为状态环图 + 全车保养页），列表 key 仍用稳定 id', () => {
    const reminder: string = fsx.readFileSync('pages/reminder/index.ts', 'utf-8');
    // 保养明细已移到 pages/maintain-all，概览只留环图数据
    expect(reminder).not.toMatch(/key: `\$\{m\.carSourceId\}#\$\{m\.name\}`/);
    expect(reminder).toContain('buildMaintainRing');
    // 最近记录仍是稳定 id
    expect(reminder).toContain('key: r.sourceId');

    // 新页的保养项 key 用保养项自身的 sourceId（不是下标）
    const all: string = fsx.readFileSync('pages/maintain-all/index.ts', 'utf-8');
    expect(all).toContain('key: it.maintain.sourceId');
  });
});

describe('死代码已清理（防止又加回来）', () => {
  const read = (p: string): string => fsx.readFileSync(p, 'utf-8');

  it('未使用的导出常量已删除', () => {
    expect(read('utils/chart-render.ts')).not.toContain('export const LABEL_FONT');
    expect(read('utils/share-card-draw.ts')).not.toContain('export const SHARE_CARD_WIDTH');
    expect(read('utils/icon-store.ts')).not.toContain('export const ICON_FILE_PREFIX');
  });

  it('设计令牌只保留真正被引用的', () => {
    const tokens = read('utils/tokens.ts');
    expect(tokens).not.toContain('COLOR_BG');
    expect(tokens).not.toContain('COLOR_CARD =');
    expect(tokens).not.toContain('COLOR_TEXT_3');
    // 这两个被测试与页面使用，必须保留
    expect(tokens).toContain('COLOR_PRIMARY');
    expect(tokens).toContain('COMPONENT_ACTIVE_COLOR');
  });

  it('页面里算了却没人用的字段已删除', () => {
    expect(read('pages/statistics/index.ts')).not.toContain('hasCharge');
    expect(read('pages/vehicle-detail/index.ts')).not.toContain('maintainTotal');
  });

  it('详情页未绑定的方法已删除，被绑定的保留', () => {
    const detail = read('pages/vehicle-detail/index.ts');
    expect(detail).not.toContain('onOpenStatistics()');
    expect(detail).toContain('onOpenStatisticsYear()');
    // 车辆页的那个确实被 wxml 使用，不能删
    expect(read('pages/index/index.ts')).toContain('onOpenStatistics()');
  });

  it('bar-chart 不再声明未使用的 unit 属性', () => {
    expect(read('components/bar-chart/index.ts')).not.toContain('unit: { type: String');
    const wxml = read('pages/statistics/index.wxml');
    expect(wxml).not.toContain('unit="km"');
    expect(wxml).not.toContain('unit="元"');
  });
});

describe('工程配置一致性', () => {
  const fsx2 = require('fs') as any;
  const project = JSON.parse(fsx2.readFileSync('project.config.json', 'utf-8'));
  const priv = JSON.parse(fsx2.readFileSync('project.private.config.json', 'utf-8'));

  it('基础库版本与私有配置一致', () => {
    expect(project.libVersion).toBe(priv.libVersion);
  });

  it('打包忽略列表包含构建产物与测试数据', () => {
    const ignored = (project.packOptions.ignore || []).map((x: any) => x.value);
    expect(ignored).toContain('dist');
    expect(ignored).toContain('tests');
    expect(ignored).toContain('docs');
    expect(ignored).toContain('test-data');
  });
});

describe('离屏画布：即使 fixed 失效也不会露出来', () => {
  it('两处离屏 canvas 都加了 opacity: 0', () => {
    ['pages/statistics/index.wxss', 'pages/icon-crop/index.wxss'].forEach(p => {
      const css: string = fsx.readFileSync(p, 'utf-8');
      expect(css).toMatch(/opacity:\s*0\s*;/);
      expect(css).toContain('pointer-events: none');
    });
  });
});
