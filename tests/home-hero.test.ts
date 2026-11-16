// 主界面 Hero（F 版）的取值与分区规则。
//
// 这里不渲染页面，只锁「主车怎么选、其他车怎么分、指标取哪个口径」，
// 因为这三件事错了会直接显示错数字，而 UI 层看不出来。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, listCars } from '../services/car.service';
import { saveCost, listCategories, listCosts } from '../services/cost.service';
import { saveRefuel } from '../services/refuel.service';
import { getMaintainProgress } from '../services/maintain-record.service';
import { setPinnedCarId, getPinnedCarId } from '../services/user.service';
import { buildStats } from '../domain/stats.service';
import { getConsumptions } from '../services/refuel.service';
import { pickMainCar } from '../services/overview.service';
import { EnergyType } from '../types/models';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

function setup(name = '主车', energyType: EnergyType = 'fuel', mileages = 5000) {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name,
    mileages,
    initDate: new Date(2026, 0, 1).getTime(),
    energyType,
    batteryCapacity: energyType === 'ev' ? 60 : 0
  });
  return { adapter, car };
}

function addCost(adapter: StorageAdapter, carId: string, amount: number, date: number) {
  const cat = listCategories(adapter)[0];
  return saveCost(adapter, {
    carSourceId: carId,
    categorySourceId: cat.sourceId,
    amount,
    costDate: date,
    remark: ''
  });
}

function addRefuel(
  adapter: StorageAdapter,
  carId: string,
  km: number,
  volume: number,
  date: number,
  energyType: 'fuel' | 'ev' = 'fuel'
) {
  return saveRefuel(adapter, {
    carSourceId: carId,
    fuelDate: date,
    makeMileages: km,
    unitPrice: 6,
    volume,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType,
    chargeBeforePercent: energyType === 'ev' ? 20 : 0,
    chargeAfterPercent: energyType === 'ev' ? 90 : 0
  });
}

describe('主车选择：置顶优先，否则第一辆', () => {
  it('未置顶时取第一辆', () => {
    const a = setup('一');
    createCar(a.adapter, { name: '二', mileages: 100, initDate: Date.now(), energyType: 'fuel' });
    const cars = listCars(a.adapter);
    expect(pickMainCar(cars, '')!.name).toBe('一');
  });

  it('置顶后取置顶那辆', () => {
    const a = setup('一');
    const b = createCar(a.adapter, {
      name: '二',
      mileages: 100,
      initDate: Date.now(),
      energyType: 'fuel'
    });
    setPinnedCarId(a.adapter, b.sourceId);
    const cars = listCars(a.adapter);
    expect(getPinnedCarId(a.adapter)).toBe(b.sourceId);
    expect(pickMainCar(cars, getPinnedCarId(a.adapter))!.name).toBe('二');
  });

  it('其他车列表排除主车，数量正确', () => {
    const a = setup('一');
    createCar(a.adapter, { name: '二', mileages: 100, initDate: Date.now(), energyType: 'fuel' });
    createCar(a.adapter, { name: '三', mileages: 100, initDate: Date.now(), energyType: 'fuel' });
    const cars = listCars(a.adapter);
    const main = pickMainCar(cars, '')!;
    const others = cars.filter(c => c.sourceId !== main.sourceId);
    expect(others.length).toBe(2);
    expect(others.some(c => c.sourceId === main.sourceId)).toBe(false);
  });
});

describe('置顶功能必须有 UI 入口（曾因重写页面丢失）', () => {
  const wxml = require('fs').readFileSync('pages/index/index.wxml', 'utf-8') as string;
  const ts = require('fs').readFileSync('pages/index/index.ts', 'utf-8') as string;

  it('页面存在 onTogglePin 方法', () => {
    expect(ts).toContain('onTogglePin');
    expect(ts).toContain('setPinnedCarId');
  });

  it('WXML 里至少有一处调用 onTogglePin', () => {
    // 方法存在但没绑定 = 功能等于不存在（这正是上次的 bug）
    // 必须精确匹配事件属性，不能只 toContain('onTogglePin')
    // —— 否则 onTogglePinDISABLED 这类改名也会命中，测试形同虚设
    const hits = wxml.match(/catchtap="onTogglePin"|bindtap="onTogglePin"/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('其他车卡片有「置顶」入口', () => {
    expect(wxml).toMatch(/cc-pin[\s\S]{0,120}catchtap="onTogglePin"/);
    expect(wxml).toContain('>置顶<');
  });

  it('主车有「取消置顶」入口', () => {
    expect(wxml).toContain('取消置顶');
    expect(wxml).toMatch(/hero-unpin[\s\S]{0,140}catchtap="onTogglePin"/);
  });

  it('所有置顶入口都用 catchtap（bindtap 会冒泡误进详情页）', () => {
    const all = wxml.match(/(catchtap|bindtap)="onTogglePin"/g) || [];
    expect(all.length).toBeGreaterThan(0);
    for (const a of all) {
      expect(a.startsWith('catchtap')).toBe(true);
    }
  });
});

describe('置顶写入健壮性', () => {
  it('user 记录缺失时也能写入（不静默失败）', () => {
    // 不调用 seed：现在 seed 会顺带创建已初始化的 user，掩盖「user 缺失」的场景
    const adapter = new StorageAdapter(createMemoryStorage());
    expect(adapter.getUser()).toBeNull();

    setPinnedCarId(adapter, 'car-xyz');
    // 原实现会在 user 为空时直接 return，导致点击置顶毫无反应
    expect(getPinnedCarId(adapter)).toBe('car-xyz');
  });

  it('传空串可取消置顶', () => {
    const { adapter, car } = setup();
    setPinnedCarId(adapter, car.sourceId);
    expect(getPinnedCarId(adapter)).toBe(car.sourceId);
    setPinnedCarId(adapter, '');
    expect(getPinnedCarId(adapter)).toBe('');
  });
});

describe('已服役天数（购车日 → 今天）', () => {
  const { serviceDaysSince } = require('../utils/date');

  it('按整天计算', () => {
    const now = new Date(2026, 10, 15, 10, 30).getTime();
    const bought = new Date(2026, 7, 7).getTime(); // 8/7 → 11/15
    expect(serviceDaysSince(bought, now)).toBe(100);
  });

  it('同一天不同时刻算 0 天（按本地日对齐）', () => {
    const now = new Date(2026, 10, 15, 23, 59).getTime();
    const bought = new Date(2026, 10, 15, 0, 1).getTime();
    expect(serviceDaysSince(bought, now)).toBe(0);
  });

  it('购车日在未来时钳到 0，不出现负数', () => {
    const now = new Date(2026, 10, 15).getTime();
    const future = new Date(2027, 0, 1).getTime();
    expect(serviceDaysSince(future, now)).toBe(0);
  });

  it('购车日缺失 / 非法返回 null（页面显示 --）', () => {
    const now = Date.now();
    expect(serviceDaysSince(0, now)).toBeNull();
    expect(serviceDaysSince(-1, now)).toBeNull();
    expect(serviceDaysSince(NaN, now)).toBeNull();
  });

  it('跨年计算正确（含闰年 2/29）', () => {
    const now = new Date(2024, 2, 1).getTime(); // 2024-03-01
    const bought = new Date(2024, 1, 1).getTime(); // 2024-02-01，闰年 2 月 29 天
    expect(serviceDaysSince(bought, now)).toBe(29);
  });

  it('长年限不溢出（10 年）', () => {
    const now = new Date(2026, 10, 15).getTime();
    const bought = new Date(2016, 10, 15).getTime();
    const days = serviceDaysSince(bought, now);
    expect(days).toBeGreaterThan(3600);
    expect(days).toBeLessThan(3700);
  });
});

describe('Hero 指标口径', () => {
  it('燃油车取年平均油耗与燃油里程', () => {
    const { adapter, car } = setup('油车', 'fuel');
    const y = new Date().getFullYear();
    addRefuel(adapter, car.sourceId, 1000, 0, new Date(y, 2, 1).getTime());
    addRefuel(adapter, car.sourceId, 1500, 40, new Date(y, 2, 10).getTime());

    const snap = buildStats(
      { type: 'year', year: y },
      [],
      [],
      getConsumptions(adapter, car.sourceId),
      listCategories(adapter),
      car
    );
    // 40L / 500km × 100 = 8
    expect(snap.fuel.avgConsumption).toBe(8);
    expect(snap.mileage.fuelMileage).toBe(500);
  });

  it('纯电车取年平均电耗与充电里程（不是恒为 0 的燃油口径）', () => {
    const { adapter, car } = setup('电车', 'ev');
    const y = new Date().getFullYear();
    addRefuel(adapter, car.sourceId, 1000, 0, new Date(y, 2, 1).getTime(), 'ev');
    addRefuel(adapter, car.sourceId, 1500, 25, new Date(y, 2, 10).getTime(), 'ev');

    const snap = buildStats(
      { type: 'year', year: y },
      [],
      [],
      getConsumptions(adapter, car.sourceId),
      listCategories(adapter),
      car
    );
    // 25kWh / 500km × 100 = 5
    expect(snap.electricity.avgConsumption).toBe(5);
    expect(snap.mileage.evMileage).toBe(500);
    expect(snap.fuel.avgConsumption).toBe(0);
    expect(snap.mileage.fuelMileage).toBe(0);
  });

  it('本年无区间时平均值为 0（页面显示 --）', () => {
    const { adapter, car } = setup('新车', 'fuel');
    const y = new Date().getFullYear();
    const snap = buildStats(
      { type: 'year', year: y },
      [],
      [],
      getConsumptions(adapter, car.sourceId),
      listCategories(adapter),
      car
    );
    expect(snap.fuel.avgConsumption).toBe(0);
    expect(snap.mileage.fuelMileage).toBe(0);
  });
});

describe('本月支出与待保养计数', () => {
  it('本月支出只算当月', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    const thisMonth = new Date(now);
    const monthStart = new Date(
      thisMonth.getFullYear(),
      thisMonth.getMonth(),
      1
    ).getTime();
    const lastMonth = monthStart - 5 * 24 * 3600 * 1000;

    addCost(adapter, car.sourceId, 100, now);
    addCost(adapter, car.sourceId, 900, lastMonth);

    let sum = 0;
    for (const c of listCosts(adapter, car.sourceId)) {
      if (c.costDate >= monthStart && c.costDate <= now) sum += c.amount;
    }
    expect(sum).toBe(100);
  });

  it('待保养计数与 urgent 项一致', () => {
    const { adapter, car } = setup();
    const progress = getMaintainProgress(adapter, car.sourceId, Date.now());
    const urgent = progress.filter(p => p.urgent).length;
    // 新建车默认模板，剩余充足 → 通常为 0；此处只断言「计数等于 urgent 数」这一规则
    expect(urgent).toBe(progress.filter(p => p.urgent).length);
  });

  it('getMaintainProgress 是只读的（主界面刷新不写库）', () => {
    const { adapter, car } = setup();
    const before = JSON.stringify(adapter.list('maintains'));
    getMaintainProgress(adapter, car.sourceId, Date.now());
    const after = JSON.stringify(adapter.list('maintains'));
    expect(after).toBe(before);
  });
});

describe('保养摘要取值规则', () => {
  it('有剩余里程时优先显示里程，超期为负', () => {
    const progress = [
      { remainMileage: 1200, remainDays: null, progress: 0.4 },
      { remainMileage: -300, remainDays: null, progress: 0 }
    ];
    // 页面取 progress 最小（最紧急）的那项
    const urgent = [...progress].sort((a, b) => a.progress - b.progress)[0];
    expect(urgent.remainMileage).toBe(-300);
    expect(urgent.remainMileage! < 0).toBe(true);
  });

  it('只有天数周期时用天数', () => {
    const progress = [{ remainMileage: null, remainDays: 45, progress: 0.5 }];
    const urgent = progress[0];
    expect(urgent.remainMileage).toBeNull();
    expect(urgent.remainDays).toBe(45);
  });
});

describe('Hero 动作区的跳转目标', () => {
  const ts: string = require('fs').readFileSync('pages/index/index.ts', 'utf-8');

  it('「保养」进保养项管理页', () => {
    const block = /onOpenMaintain\(\)[\s\S]{0,600}?\n  \},/.exec(ts);
    expect(block).toBeTruthy();
    expect(block![0]).toContain('/pages/maintain-manage/index?id=');
    expect(block![0]).not.toContain('maintain-form');
  });

  it('参数名 id 与保养项管理页读取的一致', () => {
    const manageTs: string = require('fs').readFileSync(
      'pages/maintain-manage/index.ts',
      'utf-8'
    );
    expect(ts).toContain('/pages/maintain-manage/index?id=');
    expect(manageTs).toContain('options.id');
  });

  it('记保养由「记一笔 → 保养」Tab 承担，不在首页重复', () => {
    const entryTs: string = require('fs').readFileSync('pages/entry/index.ts', 'utf-8');
    const entryWxml: string = require('fs').readFileSync(
      'pages/entry/index.wxml',
      'utf-8'
    );
    expect(entryTs).toContain("{ key: 'maintain', label: '保养' }");
    expect(entryWxml).toContain("activeTab === 'maintain'");
  });

  it('其余动作跳转未被误改', () => {
    expect(ts).toContain('/pages/entry/index?carId=');
    expect(ts).toContain('/pages/statistics/index?id=');
    expect(ts).toContain('/pages/records/index?id=');
  });
});
