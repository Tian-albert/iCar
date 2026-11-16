// 概览页 load() 的**运行时**冒烟测试。
//
// 为什么需要它：项目里其它测试都是读文件做字符串断言，跑不到页面逻辑。
// 曾出现「源码引用了未定义的变量」导致真机 `ReferenceError: xxx is not defined`，
// 而静态断言完全看不出来（删掉一个 const 定义、漏掉一处引用，测试全绿）。
// 这里真正注册 Page、构造实例、执行一次 load()，任何未定义标识符都会立刻抛错。

/** 存储适配器由测试逐例替换：mock 出来的 getStorage 读它 */
(globalThis as any).__adapterHolder = { adapter: null };

jest.mock('../store/index', () => {
  const actual = jest.requireActual('../store/index');
  return {
    ...actual,
    getStorage: () => {
      const holder = (globalThis as any).__adapterHolder;
      if (!holder || !holder.adapter) throw new Error('测试未注入存储适配器');
      return holder.adapter;
    }
  };
});

import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { listCategories, saveCost } from '../services/cost.service';

const DAY = 86400000;

function makeAdapter(): StorageAdapter {
  const map = new Map<string, unknown>();
  const like: StorageLike = {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => Array.from(map.keys())
  };
  return new StorageAdapter(like);
}

function useAdapter(a: StorageAdapter) {
  (globalThis as any).__adapterHolder.adapter = a;
}

function currentAdapter(): StorageAdapter {
  return (globalThis as any).__adapterHolder.adapter;
}

/** 造两辆车 + 支出，让 load() 走「有数据」的全部分支 */
function seedLibrary(a: StorageAdapter) {
  a.rebuildIndex();
  seedPresetCategories(a);
  const cat = listCategories(a)[0];
  const now = Date.now();

  [
    { name: 'CRV', init: 12000, cur: 58500, spend: 28450 },
    { name: '汉DM-i', init: 8000, cur: 41800, spend: 16340 }
  ].forEach(c => {
    const car = createCar(a, {
      name: c.name,
      mileages: c.cur,
      initMileages: c.init,
      initDate: now - 400 * DAY,
      icon: 'car',
      energyType: 'fuel',
      batteryCapacity: 0,
      maintainSoonMileage: 500,
      maintainSoonDays: 15
    } as any);

    saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: c.spend,
      costDate: now - DAY
    } as any);
  });
}

/**
 * 构造一个页面实例。
 *
 * 必须先展开 cfg —— 真机上 `this` 是带有全部方法的页面实例，
 * `load()` 内部会调 `this.drawDonut()`，缺了方法就会误报。
 */
function makeInstance(cfg: any): any {
  return {
    ...cfg,
    data: JSON.parse(JSON.stringify(cfg.data)),
    setData(patch: any, cb?: () => void) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    },
    getTabBar: () => null,
    // drawDonut 在 setData 回调里被调用；给一个返回空节点的查询器即可
    createSelectorQuery() {
      return {
        select: () => ({
          fields: () => ({
            exec: (cb: any) => cb([{ node: null, width: 319, height: 186, left: 0, top: 0 }])
          })
        })
      };
    }
  };
}

let cfg: any = null;

beforeAll(() => {
  useAdapter(makeAdapter());
  seedLibrary(currentAdapter());

  (globalThis as any).Page = (c: any) => { cfg = c; };
  (globalThis as any).wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, pixelRatio: 2 }),
    showShareMenu: () => undefined,
    navigateTo: () => undefined,
    showToast: () => undefined
  };

  // 模块顶层会调用 Page({...})，require 时把配置捕获下来
  require('../pages/reminder/index');
});

describe('概览页 load() 运行时不报错', () => {
  it('页面配置已注册，且 load 是可执行的方法', () => {
    expect(cfg).toBeTruthy();
    expect(typeof cfg.load).toBe('function');
  });

  it('有数据时 load() 能完整执行，不抛未定义标识符', () => {
    const inst = makeInstance(cfg);
    expect(() => cfg.load.call(inst)).not.toThrow();
  });

  it('load() 后三格指标都有值', () => {
    const inst = makeInstance(cfg);
    cfg.load.call(inst);

    expect(inst.data.hasCar).toBe(true);
    expect(inst.data.carCount).toBe(2);
    expect(String(inst.data.yearTotalText).length).toBeGreaterThan(0);
    expect(String(inst.data.totalDrivenText).length).toBeGreaterThan(0);
  });

  it('图例与环图扇区一一对应（segIndex 是有效下标，不是未定义变量）', () => {
    const inst = makeInstance(cfg);
    cfg.load.call(inst);

    const { carCosts, donutSegments } = inst.data;
    expect(Array.isArray(carCosts)).toBe(true);
    expect(carCosts.length).toBeGreaterThan(0);
    expect(carCosts.length).toBe(donutSegments.length);
    carCosts.forEach((c: any, i: number) => {
      expect(typeof c.segIndex).toBe('number');
      expect(c.segIndex).toBe(i);
      expect(c.segIndex).toBeLessThan(donutSegments.length);
    });
  });

  it('出行成本图块字段齐全（金额/里程/字号/每公里成本）', () => {
    const inst = makeInstance(cfg);
    cfg.load.call(inst);

    const tiles = inst.data.drivingCosts;
    expect(tiles.length).toBe(2);
    tiles.forEach((t: any) => {
      expect(t.spendText).toBeTruthy();
      expect(t.kmText.endsWith(' km')).toBe(true);
      expect(t.perKmText.startsWith('￥')).toBe(true);
      expect(typeof t.fontText).toBe('string');
      expect(Number(t.fontText)).toBeGreaterThan(0);
      expect(t.daysText).toBeTruthy();
    });
  });

  it('每公里成本用「建档后里程」作分母', () => {
    const inst = makeInstance(cfg);
    cfg.load.call(inst);

    const crv = inst.data.drivingCosts.filter((t: any) => t.carName === 'CRV')[0];
    // 28450 / (58500 − 12000) = 0.6118 → ￥0.61
    expect(crv.perKmText).toBe('￥0.61');
    expect(crv.kmText).toBe('46,500 km');
  });

  it('没有车辆时走空态分支，不报错', () => {
    const seeded = currentAdapter();
    useAdapter(makeAdapter());
    try {
      const inst = makeInstance(cfg);
      expect(() => cfg.load.call(inst)).not.toThrow();
      expect(inst.data.hasCar).toBe(false);
      expect(inst.data.donutSegments).toEqual([]);
    } finally {
      // 还原，避免影响其它用例
      useAdapter(seeded);
    }
  });
});
