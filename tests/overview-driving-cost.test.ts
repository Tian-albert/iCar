// 概览页「出行成本」数据层：建档后里程、全时段花费、每公里成本
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { listCategories, saveCost } from '../services/cost.service';
import { buildOverview } from '../services/overview.service';
import { Category } from '../types/models';

const fsx = require('fs') as any;
const DAY = 24 * 60 * 60 * 1000;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function setup() {
  const a = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(a);
  const cat = listCategories(a)[0];
  return { a, cat };
}

/** 造一辆车并写入若干支出 */
function makeCar(
  a: StorageAdapter,
  cat: Category,
  opts: {
    name: string;
    initMileages: number;
    mileages: number;
    initDate: number;
    costs: Array<{ amount: number; at: number }>;
  }
) {
  const car = createCar(a, {
    name: opts.name,
    mileages: opts.mileages,
    initMileages: opts.initMileages,
    initDate: opts.initDate,
    icon: 'car',
    energyType: 'fuel',
    batteryCapacity: 0,
    maintainSoonMileage: 500,
    maintainSoonDays: 15
  } as any);

  opts.costs.forEach(c => {
    saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: c.amount,
      costDate: c.at
    } as any);
  });

  return car;
}

describe('建档后行驶里程', () => {
  it('= 当前里程 − 购车时里程，并合计到 metric', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: 'A', initMileages: 12000, mileages: 58500,
      initDate: now - 100 * DAY, costs: []
    });
    makeCar(a, cat, {
      name: 'B', initMileages: 8000, mileages: 41800,
      initDate: now - 50 * DAY, costs: []
    });

    const snap = buildOverview(a, now);

    expect(snap.drivingCosts.length).toBe(2);
    const a1 = snap.drivingCosts.filter(d => d.carName === 'A')[0];
    const b1 = snap.drivingCosts.filter(d => d.carName === 'B')[0];
    expect(a1.drivenKm).toBe(46500);
    expect(b1.drivenKm).toBe(33800);
    expect(snap.metric.totalDrivenMileage).toBe(46500 + 33800);
  });

  it('当前里程小于购车里程时夹到 0（用户改错过里程）', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: '改错', initMileages: 50000, mileages: 40000,
      initDate: now - 10 * DAY, costs: []
    });

    const snap = buildOverview(a, now);
    const d = snap.drivingCosts[0];
    expect(d.drivenKm).toBe(0);
    expect(snap.metric.totalDrivenMileage).toBe(0);
  });

  it('与 current 总里程区分开：totalMileage 仍是当前里程合计', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: 'A', initMileages: 12000, mileages: 58500,
      initDate: now - 10 * DAY, costs: []
    });

    const snap = buildOverview(a, now);
    expect(snap.metric.totalMileage).toBe(58500);
    expect(snap.metric.totalDrivenMileage).toBe(46500);
  });
});

describe('出行成本：全时段花费与每公里成本', () => {
  it('总花费取全部支出，不受「本年」限制', () => {
    const { a, cat } = setup();
    const now = Date.now();
    const lastYear = new Date(new Date(now).getFullYear() - 1, 5, 1).getTime();

    makeCar(a, cat, {
      name: 'A', initMileages: 12000, mileages: 58500, initDate: now - 400 * DAY,
      costs: [
        { amount: 1000, at: lastYear },   // 去年
        { amount: 2000, at: now - DAY }   // 今年
      ]
    });

    const snap = buildOverview(a, now);
    const d = snap.drivingCosts[0];
    // 全时段 3000；而 yearTotal 只含今年 2000
    expect(d.totalSpend).toBe(3000);
    expect(snap.yearTotal).toBe(2000);
  });

  it('每公里成本 = 总花费 / 建档后里程', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: 'A', initMileages: 0, mileages: 10000, initDate: now - 30 * DAY,
      costs: [{ amount: 5000, at: now - DAY }]
    });

    const snap = buildOverview(a, now);
    expect(snap.drivingCosts[0].perKm).toBeCloseTo(0.5, 6);
  });

  it('里程为 0 时 perKm 为 0，不是 Infinity / NaN', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: '新车', initMileages: 1000, mileages: 1000, initDate: now - DAY,
      costs: [{ amount: 500, at: now - 1000 }]
    });

    const snap = buildOverview(a, now);
    const d = snap.drivingCosts[0];
    expect(d.drivenKm).toBe(0);
    expect(d.perKm).toBe(0);
    expect(isFinite(d.perKm)).toBe(true);
  });

  it('按每公里成本降序排列，便于横向比较哪辆更费', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: '省', initMileages: 0, mileages: 10000, initDate: now - 30 * DAY,
      costs: [{ amount: 2000, at: now - DAY }]        // 0.20/km
    });
    makeCar(a, cat, {
      name: '费', initMileages: 0, mileages: 10000, initDate: now - 30 * DAY,
      costs: [{ amount: 8000, at: now - DAY }]        // 0.80/km
    });

    const snap = buildOverview(a, now);
    expect(snap.drivingCosts.map(d => d.carName)).toEqual(['费', '省']);
  });

  it('服役天数按建档日期计算', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: 'A', initMileages: 0, mileages: 1000, initDate: now - 100 * DAY,
      costs: []
    });

    const snap = buildOverview(a, now);
    expect(snap.drivingCosts[0].days).toBe(100);
  });

  it('带出车辆图标，供图块显示', () => {
    const { a, cat } = setup();
    const now = Date.now();

    makeCar(a, cat, {
      name: 'A', initMileages: 0, mileages: 1000, initDate: now - DAY,
      costs: []
    });

    const snap = buildOverview(a, now);
    expect(snap.drivingCosts[0].icon).toBe('car');
  });
});

describe('概览页结构契约', () => {
  const wxml: string = fsx.readFileSync('pages/reminder/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('pages/reminder/index.ts', 'utf-8');
  const wxss: string = fsx.readFileSync('pages/reminder/index.wxss', 'utf-8');

  it('顶部是「数据总览」标题，不再是「3 辆车 · 总里程」', () => {
    expect(wxml).toContain('数据总览');
    expect(wxml).not.toContain('辆车 · 总里程');
  });

  it('三格指标为 车辆数 / 本年总支出 / 总里程', () => {
    expect(wxml).toContain('车辆数');
    expect(wxml).toContain('本年总支出');
    expect(wxml).toContain('总里程 (km)');
    // 旧的「本月总支出」「待保养」「最近记账」不再出现在指标条
    expect(wxml).not.toContain('本月总支出');
    expect(wxml).not.toContain('最近记账');
  });

  it('保养标题带待保养项数', () => {
    expect(wxml).toContain('保养提醒{{pendingCount > 0');
    expect(wxml).toContain('项待保养');
  });

  it('图例为 色点-车名-比例条-金额（与统计页一致）', () => {
    expect(wxml).toContain('lg-track');
    expect(wxml).toContain('lg-bar');
    expect(wxml).toContain('width: {{item.percent}}%');
    // 不再有单独的百分比文字列
    expect(wxml).not.toContain('lg-pct');
    // 车名/金额定宽，比例条长度才可比
    expect(wxss).toMatch(/\.lg-name \{[\s\S]{0,120}width:\s*\d+rpx/);
    expect(wxss).toMatch(/\.lg-val \{[\s\S]{0,140}width:\s*\d+rpx/);
  });

  it('环图开启外标签并支持点击', () => {
    expect(ts).toContain('showLabels: true');
    expect(ts).toContain('hitDonutSegment');
    expect(ts).toContain('labelFormatter');
    expect(wxml).toContain('bindtap="onTapDonut"');
    // 标签用整数百分比（两位小数太长会挤到相邻标签）
    expect(ts).toContain('toIntegerPercents');
  });

  it('新增「出行成本」两列图块', () => {
    expect(wxml).toContain('出行成本');
    expect(wxml).toContain('cost-grid');
    expect(wxml).toContain('tile-stripe');
    expect(wxml).toContain('服役{{item.daysText}}天');
    expect(wxml).toContain('/km');
    expect(wxml).toContain('总花费');
    expect(wxml).toContain('总里程');
    expect(wxss).toMatch(/\.cost-grid \{[\s\S]{0,120}grid-template-columns:\s*1fr 1fr/);
  });

  it('图块上下区之间有分割线、两列之间有极淡竖线', () => {
    expect(wxml).toContain('t-divider');
    expect(wxml).toContain('t-vline');
    expect(wxss).toMatch(/\.t-divider \{[\s\S]{0,100}height:\s*1px/);
    expect(wxss).toMatch(/\.t-vline \{[\s\S]{0,140}width:\s*1px/);
    expect(wxss).toMatch(/\.t-vline \{[\s\S]{0,200}background:\s*var\(--color-divider\)/);
  });

  it('金额与里程共用同一字号（由 JS 注入）', () => {
    // 两处都用 item.fontText，避免并排字号不一致
    const matches = wxml.match(/font-size: \{\{item\.fontText\}\}px/g) || [];
    expect(matches.length).toBe(2);
  });

  it('数值格式化走 utils/num-format，不在页面里硬编码压缩逻辑', () => {
    expect(ts).toContain("from '../../utils/num-format'");
    expect(ts).toContain('formatMoneyKmPair');
    expect(ts).toContain('formatPerKm');
  });

  it('每公里成本用「建档后里程」作分母（与顶部指标同口径）', () => {
    expect(ts).toContain('totalDrivenMileage');
    expect(ts).toContain('drivenKm');
  });
});
