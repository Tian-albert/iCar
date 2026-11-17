// 服务层错误处理统一（分层约定 + guardSave 传递具体原因）的回归测试。
//
// 改造前的问题：service 抛 `throw new Error('记录不存在')`，
// 但 guardSave 一律显示「保存失败，请检查输入后重试」——
// message 完全没人读，而让用户「检查输入」在记录已被删时纯属误导。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveCost, updateCost, removeCost, listCategories } from '../services/cost.service';
import { saveRefuel, updateRefuel } from '../services/refuel.service';
import { saveRepair, updateRepair } from '../services/repair.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  saveMaintainHandle,
  updateMaintainHandle
} from '../services/maintain-record.service';
import {
  ServiceError,
  serviceError,
  isUserFacingError,
  userMessageOf
} from '../services/service-error';
import { guardSave, resetSaveGuard } from '../utils/save-guard';

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

function makeCar(a: StorageAdapter, name = 'CRV') {
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

describe('ServiceError：能区分「可展示给用户」与「意外崩溃」', () => {
  it('是 Error 的子类，保留 message 与可抛出性', () => {
    const e = serviceError('这条记录已被删除');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ServiceError);
    expect(e.message).toBe('这条记录已被删除');
    expect(e.name).toBe('ServiceError');
    expect(() => { throw e; }).toThrow('这条记录已被删除');
  });

  it('instanceof 在编译到 ES5 后仍然有效（原型链已修正）', () => {
    try {
      throw serviceError('x');
    } catch (e) {
      expect(e instanceof ServiceError).toBe(true);
    }
  });

  it('isUserFacingError 只认 ServiceError', () => {
    expect(isUserFacingError(serviceError('a'))).toBe(true);
    expect(isUserFacingError(new Error('a'))).toBe(false);
    expect(isUserFacingError(new TypeError('a'))).toBe(false);
    expect(isUserFacingError('字符串')).toBe(false);
    expect(isUserFacingError(null)).toBe(false);
    expect(isUserFacingError(undefined)).toBe(false);
  });

  it('userMessageOf：ServiceError 用自身文案，其它一律 fallback', () => {
    expect(userMessageOf(serviceError('这条记录已被删除'), '兜底')).toBe('这条记录已被删除');
    // 技术细节不能漏给用户
    expect(userMessageOf(new TypeError("Cannot read property 'x' of null"), '兜底')).toBe('兜底');
    expect(userMessageOf(null, '兜底')).toBe('兜底');
  });

  it('message 为空时退回 fallback（避免 toast 空白）', () => {
    expect(userMessageOf(new ServiceError(''), '兜底')).toBe('兜底');
  });
});

describe('写入类：前置条件不满足抛 ServiceError，且文案面向用户', () => {
  it('编辑已删除的支出 → ServiceError', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    const cat = listCategories(a)[0];
    const cost = saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 100,
      costDate: Date.now()
    } as any);

    removeCost(a, cost.sourceId);

    expect(() =>
      updateCost(a, cost.sourceId, {
        carSourceId: car.sourceId,
        categorySourceId: cat.sourceId,
        amount: 200,
        costDate: Date.now()
      } as any)
    ).toThrow(ServiceError);
  });

  it('编辑不存在的维修记录 → ServiceError', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    expect(() =>
      updateRepair(a, 'mp:repair:不存在', {
        carSourceId: car.sourceId,
        content: '换刹车片',
        mileage: 1000,
        repairDate: Date.now(),
        amount: 500
      } as any)
    ).toThrow(ServiceError);
  });

  it('编辑不存在的加油记录 → ServiceError', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    expect(() =>
      updateRefuel(a, 'mp:refuel:不存在', {
        carSourceId: car.sourceId,
        fuelDate: Date.now(),
        makeMileages: 1000,
        unitPrice: 7.5,
        volume: 40,
        actualPayAmount: null,
        isFull: true,
        isLowFuel: false
      } as any)
    ).toThrow(ServiceError);
  });

  it('编辑不存在的保养记录 → ServiceError', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    expect(() =>
      updateMaintainHandle(a, 'mp:handle:不存在', {
        carSourceId: car.sourceId,
        maintainSourceIds: [],
        makeDate: Date.now(),
        makeMileages: 1000,
        amount: 300
      } as any)
    ).toThrow(ServiceError);
  });

  it('缺少预设类别时抛 ServiceError 并给出下一步动作', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    // 删掉「加油」预设类别
    const fuelCat = a
      .list<any>('categories')
      .filter((c: any) => c.presetType === 'refuel')[0];
    expect(fuelCat).toBeTruthy();
    a.softDelete('categories', fuelCat.sourceId);

    let msg = '';
    try {
      saveRefuel(a, {
        carSourceId: car.sourceId,
        fuelDate: Date.now(),
        makeMileages: 1000,
        unitPrice: 7.5,
        volume: 40,
        actualPayAmount: null,
        isFull: true,
        isLowFuel: false
      } as any);
    } catch (e) {
      msg = userMessageOf(e, '');
    }
    expect(msg).toContain('类别');
    // 必须告诉用户该做什么，而不是只说「缺失」
    expect(msg).toContain('类别管理');
  });

  it('所有抛错的文案都不含技术细节', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    const messages: string[] = [];

    const grab = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        messages.push(userMessageOf(e, ''));
      }
    };

    grab(() => updateCost(a, 'x', {} as any));
    grab(() => updateRepair(a, 'x', {} as any));
    grab(() => updateRefuel(a, 'x', {} as any));
    grab(() => updateMaintainHandle(a, 'x', {} as any));

    expect(messages.length).toBe(4);
    messages.forEach(m => {
      expect(m.length).toBeGreaterThan(0);
      // 不出现表名/字段名/英文技术词
      expect(m).not.toMatch(/[a-zA-Z_]{3,}/);
      expect(m).not.toMatch(/sourceId|undefined|null/);
      // toast 两行内能显示完
      expect(m.length).toBeLessThanOrEqual(20);
    });
  });
});

describe('查询类：查不到返回 null / 空数组，不抛错', () => {
  it('getCar 查不到返回 null', () => {
    const a = makeAdapter();
    const { getCar } = require('../services/car.service');
    expect(getCar(a, 'mp:cars:不存在')).toBeNull();
  });

  it('listCosts 对不存在的车返回空数组', () => {
    const a = makeAdapter();
    const { listCosts } = require('../services/cost.service');
    expect(listCosts(a, 'mp:cars:不存在')).toEqual([]);
  });

  it('getCategory 查不到返回 null', () => {
    const a = makeAdapter();
    const { getCategory } = require('../services/cost.service');
    expect(getCategory(a, 'mp:category:不存在')).toBeNull();
  });
});

describe('guardSave：把具体原因显示给用户', () => {
  let toasts: string[] = [];

  beforeEach(() => {
    resetSaveGuard();
    toasts = [];
    (globalThis as any).wx = {
      showToast: ({ title }: { title: string }) => toasts.push(title)
    };
    delete (globalThis as any).getCurrentPages;
  });

  afterEach(() => {
    delete (globalThis as any).getCurrentPages;
  });

  it('ServiceError 的具体原因原样显示', () => {
    const ok = guardSave(() => {
      throw serviceError('这条记录已被删除');
    });
    expect(ok).toBe(false);
    expect(toasts).toEqual(['这条记录已被删除']);
  });

  it('普通 Error 只显示通用兜底，不泄露技术细节', () => {
    guardSave(() => {
      throw new TypeError("Cannot read property 'amount' of null");
    });
    expect(toasts).toEqual(['保存失败，请重试']);
    expect(toasts[0]).not.toContain('amount');
  });

  it('支持自定义兜底文案', () => {
    guardSave(
      () => { throw new Error('boom'); },
      { fallbackMessage: '保存车辆失败' }
    );
    expect(toasts).toEqual(['保存车辆失败']);
  });

  it('失败后释放节流窗口，可立即重试', () => {
    guardSave(() => { throw serviceError('x'); });
    let ok = 0;
    expect(guardSave(() => { ok++; })).toBe(true);
    expect(ok).toBe(1);
  });
});

describe('guardSave：节流按页面隔离（修复跨页串扰）', () => {
  let toasts: string[] = [];

  beforeEach(() => {
    resetSaveGuard();
    toasts = [];
    (globalThis as any).wx = {
      showToast: ({ title }: { title: string }) => toasts.push(title)
    };
  });

  afterEach(() => {
    delete (globalThis as any).getCurrentPages;
  });

  function onPage(route: string) {
    (globalThis as any).getCurrentPages = () => [{ route }];
  }

  it('A 页保存后，B 页 600ms 内的保存不会被吞掉', () => {
    onPage('pages/cost-form/index');
    let aCalls = 0;
    expect(guardSave(() => { aCalls++; })).toBe(true);

    // 立刻切到另一页保存 —— 改造前这里会被静默忽略
    onPage('pages/refuel-form/index');
    let bCalls = 0;
    expect(guardSave(() => { bCalls++; })).toBe(true);

    expect(aCalls).toBe(1);
    expect(bCalls).toBe(1);
  });

  it('同一页面内的连点仍被节流', () => {
    onPage('pages/cost-form/index');
    let calls = 0;
    const action = () => { calls++; };
    expect(guardSave(action)).toBe(true);
    expect(guardSave(action)).toBe(false);
    expect(guardSave(action)).toBe(false);
    expect(calls).toBe(1);
  });

  it('拿不到页面栈时退回默认分组，仍能防连点', () => {
    let calls = 0;
    const action = () => { calls++; };
    expect(guardSave(action)).toBe(true);
    expect(guardSave(action)).toBe(false);
    expect(calls).toBe(1);
  });

  it('显式传 key 时按 key 分组', () => {
    let a = 0;
    let b = 0;
    expect(guardSave(() => { a++; }, { key: 'a' })).toBe(true);
    expect(guardSave(() => { b++; }, { key: 'b' })).toBe(true);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

describe('分层约定：代码里必须留下依据', () => {
  it('service-error.ts 说明了三种处理方式的分工', () => {
    const src: string = fsx.readFileSync('services/service-error.ts', 'utf-8');
    expect(src).toContain('查询类');
    expect(src).toContain('写入类');
    expect(src).toContain('可部分成功');
    expect(src).toContain('ServiceError');
  });

  it('服务层不再有裸的 throw new Error', () => {
    const files = fsx.readdirSync('services').filter((f: string) => f.endsWith('.ts'));
    const offenders: string[] = [];
    files.forEach((f: string) => {
      const src: string = fsx.readFileSync(`services/${f}`, 'utf-8');
      // 允许注释里出现，只看真正的语句
      const bad = src
        .split('\n')
        .filter((l: string) => /^\s*[^*/]*throw new Error\(/.test(l));
      if (bad.length) offenders.push(`${f}: ${bad.join(' | ')}`);
    });
    expect(offenders).toEqual([]);
  });

  it('抛 ServiceError 的文件都 import 了它', () => {
    const files = fsx
      .readdirSync('services')
      .filter((f: string) => f.endsWith('.ts') && f !== 'service-error.ts');
    let checked = 0;
    files.forEach((f: string) => {
      const src: string = fsx.readFileSync(`services/${f}`, 'utf-8');
      if (src.includes('throw serviceError(')) {
        checked++;
        expect(src).toContain("from './service-error'");
      }
    });
    // 确认确实检查到了东西，避免文件改名后这条测试变成空跑
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it('页面通过 guardSave 调用写入类服务（错误才会被兜住）', () => {
    const pages = ['pages/cost-form/index.ts', 'pages/repair-form/index.ts'];
    pages.forEach(p => {
      const src: string = fsx.readFileSync(p, 'utf-8');
      expect(src).toContain('guardSave');
    });
  });
});
