// 服务层「错误契约」的回归测试。
//
// 注释容易腐化：有人给 removeXxx 加了 throw，或把查询类改成抛错，
// 代码照样能跑，但约定就被破坏了。这里把约定变成可执行的断言。
//
// 核心判据（见 services/service-error.ts）：
//   用户是否「刚刚提交了一个明确的操作、且必须知道结果」。
//   是 → 抛 ServiceError；否 → 静默返回 / 返回 false。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, setCarIcon, getCar } from '../services/car.service';
import {
  saveCost,
  removeCost,
  updateCost,
  listCategories,
  getCategory,
  setCategoryIcon,
  setCategoryVisible,
  updateCategory,
  moveCategory,
  moveCategoryBy
} from '../services/cost.service';
import { saveRepair, removeRepair, updateRepair } from '../services/repair.service';
import { saveRefuel, removeRefuel, updateRefuel } from '../services/refuel.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  removeMaintain,
  removeMaintainHandle,
  saveMaintainHandle,
  updateMaintainHandle
} from '../services/maintain-record.service';
import { restoreBatch, deleteCarCascade } from '../services/recycle.service';
import { getUser } from '../services/user.service';
import { ServiceError } from '../services/service-error';

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

/** 断言不抛错（静默返回） */
function expectSilent(fn: () => void) {
  expect(fn).not.toThrow();
}

/** 断言抛 ServiceError 且文案面向用户 */
function expectUserError(fn: () => void, mustContain?: string) {
  let caught: any = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ServiceError);
  if (mustContain) expect(caught.message).toContain(mustContain);
  return caught;
}

// ---------------------------------------------------------------- 写入类：抛错

describe('写入类（updateXxx）：目标不存在必须抛 ServiceError', () => {
  it('updateCost', () => {
    const a = makeAdapter();
    expectUserError(() => updateCost(a, 'mp:costs:无', {} as any), '删除');
  });

  it('updateRepair', () => {
    const a = makeAdapter();
    expectUserError(() => updateRepair(a, 'mp:repair:无', {} as any), '删除');
  });

  it('updateRefuel', () => {
    const a = makeAdapter();
    expectUserError(() => updateRefuel(a, 'mp:refuel:无', {} as any), '删除');
  });

  it('updateMaintainHandle', () => {
    const a = makeAdapter();
    expectUserError(() => updateMaintainHandle(a, 'mp:handle:无', {} as any), '删除');
  });

  it('已软删的记录也算「不存在」，同样抛错', () => {
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

    expectUserError(() =>
      updateCost(a, cost.sourceId, {
        carSourceId: car.sourceId,
        categorySourceId: cat.sourceId,
        amount: 200,
        costDate: Date.now()
      } as any)
    );
  });
});

// ---------------------------------------------------------------- 删除类：幂等

describe('删除类（removeXxx）：幂等，绝不抛错', () => {
  it('removeCost 对不存在的 id 静默返回', () => {
    const a = makeAdapter();
    expectSilent(() => removeCost(a, 'mp:costs:无'));
  });

  it('removeCost 重复删除同一条不抛错', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    const cat = listCategories(a)[0];
    const cost = saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 100,
      costDate: Date.now()
    } as any);

    expectSilent(() => removeCost(a, cost.sourceId));
    expectSilent(() => removeCost(a, cost.sourceId));
  });

  it('removeRepair / removeRefuel 对不存在的 id 静默返回', () => {
    const a = makeAdapter();
    expectSilent(() => removeRepair(a, 'mp:repair:无'));
    expectSilent(() => removeRefuel(a, 'mp:refuel:无'));
  });

  it('removeMaintain / removeMaintainHandle 对不存在的 id 静默返回', () => {
    const a = makeAdapter();
    expectSilent(() => removeMaintain(a, 'mp:maintain:无'));
    expectSilent(() => removeMaintainHandle(a, 'mp:handle:无'));
  });
});

// ------------------------------------------------- 设置类（setXxx）：静默返回

describe('设置类（setXxx）：目标不存在静默返回，不打断用户', () => {
  it('setCarIcon 对不存在的车静默返回', () => {
    const a = makeAdapter();
    expectSilent(() => setCarIcon(a, 'mp:cars:无', '🚗'));
  });

  it('setCarIcon 对存在的车正常生效', () => {
    const a = makeAdapter();
    const car = makeCar(a);
    setCarIcon(a, car.sourceId, '🚙');
    expect(getCar(a, car.sourceId)!.icon).toBe('🚙');
  });

  it('setCategoryIcon / setCategoryVisible 对不存在的类别静默返回', () => {
    const a = makeAdapter();
    expectSilent(() => setCategoryIcon(a, 'mp:category:无', '🚗'));
    expectSilent(() => setCategoryVisible(a, 'mp:category:无', false));
  });

  it('updateCategory 对系统预设静默返回（不改名）', () => {
    const a = makeAdapter();
    const preset = a.list<any>('categories').filter((c: any) => c.presetType)[0];
    expect(preset).toBeTruthy();
    const before = preset.name;

    expectSilent(() => updateCategory(a, preset.sourceId, '改个名', '🚗'));
    expect(getCategory(a, preset.sourceId)!.name).toBe(before);
  });
});

// ------------------------------------------------------- boolean：false 不是错误

describe('boolean 返回：false 表示「没发生」，不是错误', () => {
  it('moveCategory 对不存在的类别返回 false', () => {
    const a = makeAdapter();
    expect(moveCategory(a, 'mp:category:无', 'up')).toBe(false);
  });

  it('moveCategory 对已在首位的项返回 false（边界，不是错误）', () => {
    const a = makeAdapter();
    const first = listCategories(a).filter(c => !c.presetType)[0];
    expect(first).toBeTruthy();
    // 第一个非系统预设已在最前
    expect(moveCategory(a, first.sourceId, 'up')).toBe(false);
  });

  it('moveCategory 对系统预设返回 false', () => {
    const a = makeAdapter();
    const preset = a.list<any>('categories').filter((c: any) => c.presetType)[0];
    expect(moveCategory(a, preset.sourceId, 'down')).toBe(false);
  });

  it('moveCategoryBy 在 steps=0 或越界时返回 false', () => {
    const a = makeAdapter();
    const cat = listCategories(a).filter(c => !c.presetType)[0];
    expect(moveCategoryBy(a, cat.sourceId, 0)).toBe(false);
  });

  it('restoreBatch 对不存在的批次返回 false', () => {
    const a = makeAdapter();
    expect(restoreBatch(a, 'batch-不存在')).toBe(false);
  });

  it('deleteCarCascade 对不存在的车返回 false', () => {
    const a = makeAdapter();
    expect(deleteCarCascade(a, 'mp:cars:无')).toBe(false);
  });
});

// ------------------------------------------------------------- 查询类：null

describe('查询类：查不到返回 null / 空数组，绝不抛错', () => {
  it('getCar / getCategory / getUser 对不存在的返回 null', () => {
    const a = makeAdapter();
    expect(getCar(a, 'mp:cars:无')).toBeNull();
    expect(getCategory(a, 'mp:category:无')).toBeNull();
    // 从未初始化过 user 的新库
    const empty = new StorageAdapter({
      get: () => undefined,
      set: () => undefined,
      remove: () => undefined,
      keys: () => []
    } as any);
    expect(getUser(empty)).toBeNull();
  });

  it('查询类不抛 ServiceError（否则页面会走进异常分支而非空态）', () => {
    const a = makeAdapter();
    const calls = [
      () => getCar(a, '无'),
      () => getCategory(a, '无'),
      () => getUser(a),
      () => listCategories(a),
      () => listMaintains(a, '无')
    ];
    calls.forEach(fn => {
      let err: any = null;
      try {
        fn();
      } catch (e) {
        err = e;
      }
      expect(err).toBeNull();
    });
  });
});

// ---------------------------------------------------------------- 契约文档

describe('契约在代码里留下了依据', () => {
  const read = (p: string): string => fsx.readFileSync(p, 'utf-8');

  it('service-error.ts 写明了「何时抛、何时静默」的判据', () => {
    const src = read('services/service-error.ts');
    expect(src).toContain('用户是否');
    expect(src).toContain('updateCost');
    expect(src).toContain('setCarIcon');
    expect(src).toContain('moveCategory');
    expect(src).toContain('幂等');
  });

  it('删除类函数注释里标明了幂等', () => {
    const files = ['cost', 'repair', 'refuel', 'maintain-record'];
    let found = 0;
    files.forEach(f => {
      const src = read(`services/${f}.service.ts`);
      // 每个 removeXxx 前的注释块应含「幂等」
      const re = /\/\*\*[\s\S]{0,400}幂等[\s\S]{0,400}export function remove/g;
      const m = src.match(re);
      if (m) found += m.length;
    });
    expect(found).toBeGreaterThanOrEqual(4);
  });

  it('服务层没有裸的 throw new Error', () => {
    const files = fsx.readdirSync('services').filter((f: string) => f.endsWith('.ts'));
    const offenders: string[] = [];
    files.forEach((f: string) => {
      const src = read(`services/${f}`);
      src.split('\n').forEach((l: string, i: number) => {
        if (/^\s*[^*/]*throw new Error\(/.test(l)) offenders.push(`${f}:${i + 1}`);
      });
    });
    expect(offenders).toEqual([]);
  });

  it('服务层不存在相邻的重复注释块（插入注释时容易踩）', () => {
    const files = fsx.readdirSync('services').filter((f: string) => f.endsWith('.ts'));
    const offenders: string[] = [];
    files.forEach((f: string) => {
      const lines = read(`services/${f}`).split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/\*\/\s*$/.test(lines[i]) && /^\s*\/\*\*/.test(lines[i + 1])) {
          offenders.push(`${f}:${i + 1}`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});
