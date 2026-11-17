// 概览页跨车聚合（services/overview.service）
//
// 重点防的是「重复计算支出」：加油会自动生成一条 Cost（fuelRecordSourceId 关联），
// 若汇总时再叠加加油金额，总支出就会翻倍。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveCost, listCategories } from '../services/cost.service';
import { saveRefuel } from '../services/refuel.service';
import { buildOverview, pickMainCar, RECENT_LIMIT, STALE_DAYS } from '../services/overview.service';
import { ensureMaintainTemplates } from '../services/maintain-record.service';
import { setRemindEnabled } from '../services/user.service';
import { Car } from '../types/models';

const DAY = 24 * 60 * 60 * 1000;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

function setup(carName = 'A车', mileages = 5000) {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: carName,
    mileages,
    initDate: new Date(2026, 0, 1).getTime(),
    energyType: 'fuel'
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

function addRefuel(adapter: StorageAdapter, carId: string, volume: number, price: number, date: number) {
  return saveRefuel(adapter, {
    carSourceId: carId,
    fuelDate: date,
    makeMileages: 1000,
    unitPrice: price,
    volume,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'fuel',
    chargeBeforePercent: 0,
    chargeAfterPercent: 0
  });
}

describe('概览：空态', () => {
  it('没有车辆时不报错，各指标为空', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(adapter);
    const snap = buildOverview(adapter, Date.now());
    expect(snap.metric.carCount).toBe(0);
    expect(snap.metric.lastRecordDays).toBeNull();
    expect(snap.maintain).toEqual([]);
    expect(snap.carCosts).toEqual([]);
    expect(snap.recent).toEqual([]);
    expect(snap.stale).toBeNull();
    expect(snap.mainCarId).toBe('');
  });

  it('有车但无记录：最近记账为 null，不误报漏记', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    const snap = buildOverview(adapter, now);
    expect(snap.metric.carCount).toBe(1);
    expect(snap.metric.lastRecordDays).toBeNull();
    // 车辆刚建（createdAt=now），不应算漏记
    expect(snap.stale).toBeNull();
  });
});

describe('概览：保养提醒总开关（User.remindEnabled）', () => {
  function setupUrgent() {
    const adapter = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(adapter);
    // 购车里程 0 + 当前 19550 → 空气滤芯 20000km 周期剩 450km ≤ 500 阈值，产生 urgent 项
    const car = createCar(adapter, {
      name: 'A车',
      mileages: 19550,
      initMileages: 0,
      initDate: new Date(2026, 0, 1).getTime(),
      energyType: 'fuel'
    });
    ensureMaintainTemplates(adapter, car.sourceId);
    return { adapter, car };
  }

  it('开关开启（默认）：有待保养项', () => {
    const { adapter } = setupUrgent();
    const snap = buildOverview(adapter, Date.now());
    expect(snap.remindEnabled).toBe(true);
    expect(snap.pendingCount).toBeGreaterThan(0);
    expect(snap.maintain.length).toBeGreaterThan(0);
  });

  it('开关关闭：不计算待保养，maintain 空、pendingCount 为 0', () => {
    const { adapter } = setupUrgent();
    setRemindEnabled(adapter, false);
    const snap = buildOverview(adapter, Date.now());
    expect(snap.remindEnabled).toBe(false);
    expect(snap.maintain).toEqual([]);
    expect(snap.pendingCount).toBe(0);
    // 关闭不影响其他区块：车辆数、支出口径照常
    expect(snap.metric.carCount).toBe(1);
  });
});

describe('概览：支出不重复计算（关键）', () => {
  it('加油自动生成的 Cost 只计一次，不叠加加油金额', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    // 单价 6 元 × 50 升 = 300 元，saveRefuel 内部会写一条 amount=300 的 Cost
    addRefuel(adapter, car.sourceId, 50, 6, now);

    const snap = buildOverview(adapter, now);
    // 若重复计算会得到 600
    expect(snap.metric.monthCost).toBe(300);
    expect(snap.yearTotal).toBe(300);
  });

  it('加油生成的支出在最近记录里标记为「加油/充电记录」区块', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    addRefuel(adapter, car.sourceId, 50, 6, now);

    const snap = buildOverview(adapter, now);
    expect(snap.recent.length).toBe(1);
    expect(snap.recent[0].section).toBe('records');
    expect(snap.recent[0].amount).toBe(300);
  });
});

describe('概览：本月 / 今年口径', () => {
  it('本月总支出只算当月，今年合计只算当年', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    const thisMonth = new Date(now).getTime();
    const lastYear = new Date(new Date(now).getFullYear() - 1, 5, 1).getTime();

    addCost(adapter, car.sourceId, 100, thisMonth);
    addCost(adapter, car.sourceId, 900, lastYear);

    const snap = buildOverview(adapter, now);
    expect(snap.metric.monthCost).toBe(100);
    // 去年那笔不计入今年
    expect(snap.yearTotal).toBe(100);
  });

  it('同一年多笔累加', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    const y = new Date(now).getFullYear();
    addCost(adapter, car.sourceId, 100, new Date(y, 1, 10).getTime());
    addCost(adapter, car.sourceId, 250, new Date(y, 2, 10).getTime());

    const snap = buildOverview(adapter, now);
    expect(snap.yearTotal).toBe(350);
  });
});

describe('概览：按车花费', () => {
  it('按金额降序，百分比合计约 100%', () => {
    const a = setup('贵车', 8000);
    const b = createCar(a.adapter, {
      name: '省车',
      mileages: 3000,
      initDate: new Date(2026, 0, 1).getTime(),
      energyType: 'fuel'
    });
    const now = Date.now();
    const y = new Date(now).getFullYear();

    addCost(a.adapter, a.car.sourceId, 900, new Date(y, 1, 5).getTime());
    addCost(a.adapter, b.sourceId, 100, new Date(y, 1, 6).getTime());

    const snap = buildOverview(a.adapter, now);
    expect(snap.carCosts[0].carName).toBe('贵车');
    expect(snap.carCosts[0].amount).toBe(900);
    expect(snap.carCosts[1].amount).toBe(100);

    const sum = snap.carCosts.reduce((s, c) => s + c.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
  });

  it('每辆车都有独立配色，不重复', () => {
    const a = setup('车一', 8000);
    createCar(a.adapter, { name: '车二', mileages: 1000, initDate: Date.now(), energyType: 'ev' });
    const now = Date.now();
    addCost(a.adapter, a.car.sourceId, 100, now);

    const snap = buildOverview(a.adapter, now);
    const colors = snap.carCosts.map(c => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe('概览：最近记录', () => {
  it(`最多 ${RECENT_LIMIT} 条且按时间降序`, () => {
    const { adapter, car } = setup();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      addCost(adapter, car.sourceId, 10 + i, now - i * DAY);
    }
    const snap = buildOverview(adapter, now);
    expect(snap.recent.length).toBe(RECENT_LIMIT);
    // 第一条应是最近的（金额 10 那条）
    expect(snap.recent[0].amount).toBe(10);
    expect(snap.recent[0].date).toBeGreaterThan(snap.recent[1].date);
  });
});

describe('概览：漏记提醒', () => {
  it('超过阈值天数才提示，并给出准确天数', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    addCost(adapter, car.sourceId, 50, now - 40 * DAY);

    const snap = buildOverview(adapter, now);
    expect(snap.stale).not.toBeNull();
    expect(snap.stale!.carName).toBe('A车');
    expect(snap.stale!.days).toBe(40);
    expect(snap.metric.lastRecordDays).toBe(40);
  });

  it('未超过阈值不提示', () => {
    const { adapter, car } = setup();
    const now = Date.now();
    addCost(adapter, car.sourceId, 50, now - (STALE_DAYS - 2) * DAY);

    const snap = buildOverview(adapter, now);
    expect(snap.stale).toBeNull();
  });

  it('多车时取最久没记录的那辆', () => {
    const a = setup('新车', 5000);
    const b = createCar(a.adapter, {
      name: '老车',
      mileages: 1000,
      initDate: new Date(2026, 0, 1).getTime(),
      energyType: 'fuel'
    });
    const now = Date.now();
    addCost(a.adapter, a.car.sourceId, 10, now - 35 * DAY);
    addCost(a.adapter, b.sourceId, 10, now - 80 * DAY);

    const snap = buildOverview(a.adapter, now);
    expect(snap.stale!.carName).toBe('老车');
    expect(snap.stale!.days).toBe(80);
  });
});

describe('概览：主车规则', () => {
  const cars = [
    { sourceId: 'a', name: '一' },
    { sourceId: 'b', name: '二' }
  ] as Car[];

  it('有置顶取置顶', () => {
    expect(pickMainCar(cars, 'b')!.sourceId).toBe('b');
  });

  it('没置顶取第一辆', () => {
    expect(pickMainCar(cars, '')!.sourceId).toBe('a');
    expect(pickMainCar(cars, '不存在')!.sourceId).toBe('a');
  });

  it('没有车辆返回 null', () => {
    expect(pickMainCar([], 'a')).toBeNull();
  });

  it('buildOverview 的 mainCarId 与置顶一致', () => {
    const a = setup('车一', 8000);
    createCar(a.adapter, { name: '车二', mileages: 1000, initDate: Date.now(), energyType: 'ev' });
    const snap = buildOverview(a.adapter, Date.now());
    // 未设置置顶 → 第一辆
    expect(snap.mainCarId).toBe(a.car.sourceId);
  });
});
