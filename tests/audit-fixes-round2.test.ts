// 第二轮代码审计（第 1 批 + 第 2 批）修复的回归测试。
//
// 与 audit-fixes.test.ts 是两批不同的范围：那份来自 1.0.4 的上线前审计
// （纯电里程、导入净化、跨年月份、电耗上限等），这份是 11-17 这轮审计发现的
// 页面层与数据一致性问题。
//
// 这批问题之所以能长期存在，是因为全部落在「没有测试覆盖」的区域：
// 页面层的表单校验、延迟返回、迁移边界、图表角度口径、月度排序、
// 导出前的就绪校验。这里逐条补上，能跑逻辑的都真跑，不能跑的做结构断言。

/** 存储适配器由测试注入，mock 出来的 getStorage 读它 */
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
import { listCategories } from '../services/cost.service';
import { saveRefuel, updateRefuel, getEnergyCategory } from '../services/refuel.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  removeMaintain
} from '../services/maintain-record.service';
import { runMigrations, LATEST_SCHEMA_VERSION } from '../repositories/migration';
import { buildStats } from '../domain/stats.service';
import { renderDonut, computeDonutLayout } from '../utils/chart-render';
import { safeBack } from '../utils/safe-back';
import { resetSaveGuard } from '../utils/save-guard';

const fsx = require('fs') as any;
const pathx = require('path') as any;
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

/** 建一辆车 + 预置类别，返回句柄 */
function makeCar(a: StorageAdapter, name = 'CRV') {
  a.rebuildIndex();
  seedPresetCategories(a);
  const car = createCar(a, {
    name,
    mileages: 10000,
    initMileages: 0,
    initDate: Date.now() - 100 * DAY,
    icon: 'car',
    energyType: 'hybrid',
    batteryCapacity: 18,
    maintainSoonMileage: 500,
    maintainSoonDays: 15
  } as any);
  return { car, cat: listCategories(a)[0] };
}

// ---------------------------------------------------------------- 第 1 批

describe('safeBack：延迟返回不再「多退一页」', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (globalThis as any).wx = { navigateBack: jest.fn() };
  });
  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as any).getCurrentPages;
  });

  it('页面仍是栈顶 → 正常返回', () => {
    const page: any = {};
    (globalThis as any).getCurrentPages = () => [page];
    safeBack(page);
    jest.advanceTimersByTime(1000);
    expect((globalThis as any).wx.navigateBack).toHaveBeenCalledTimes(1);
  });

  it('用户已自行离开（栈顶不是该页）→ 不再返回', () => {
    const page: any = {};
    const other: any = {};
    (globalThis as any).getCurrentPages = () => [other];
    safeBack(page);
    jest.advanceTimersByTime(1000);
    expect((globalThis as any).wx.navigateBack).not.toHaveBeenCalled();
  });

  it('没有页面栈（单测/异常环境）→ 按原行为返回，不抛错', () => {
    const page: any = {};
    safeBack(page);
    jest.advanceTimersByTime(1000);
    expect((globalThis as any).wx.navigateBack).toHaveBeenCalledTimes(1);
  });

  it('默认延迟 600ms：时间未到不返回', () => {
    const page: any = {};
    (globalThis as any).getCurrentPages = () => [page];
    safeBack(page);
    jest.advanceTimersByTime(599);
    expect((globalThis as any).wx.navigateBack).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect((globalThis as any).wx.navigateBack).toHaveBeenCalledTimes(1);
  });
});

describe('全站不再直接用 setTimeout + navigateBack', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fsx.readdirSync(dir)) {
      const full = pathx.join(dir, name);
      if (fsx.statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('页面代码里没有裸的 setTimeout(() => wx.navigateBack())', () => {
    const files = walk(pathx.join('pages'));
    const bad = files.filter((f: string) =>
      fsx.readFileSync(f, 'utf-8').includes('setTimeout(() => wx.navigateBack()')
    );
    expect(bad).toEqual([]);
  });

  it('所有保存后返回的入口都走 safeBack', () => {
    const files = walk(pathx.join('pages'));
    const users = files.filter((f: string) =>
      fsx.readFileSync(f, 'utf-8').includes('safeBack(this)')
    );
    // 11 个页面、18 个调用点
    expect(users.length).toBeGreaterThanOrEqual(11);
  });
});

describe('保养项表单：不再产生幽灵项与重复项', () => {
  const src: string = fsx.readFileSync('pages/maintain-item-form/index.ts', 'utf-8');

  it('新增时校验 carId（车辆不存在则返回）', () => {
    expect(src).toContain('getCar(storage, carId)');
    expect(src).toMatch(/车辆不存在/);
  });

  it('保存走 guardSave 防重复提交', () => {
    expect(src).toContain('guardSave(');
    // 被节流/抛错时不提示成功、不返回
    expect(src).toMatch(/if \(!ok\) return;/);
  });

  it('carId 为空时拒绝写入（运行时）', () => {
    resetSaveGuard();
    const a = makeAdapter();
    useAdapter(a);
    makeCar(a);

    let cfg: any = null;
    (globalThis as any).Page = (c: any) => { cfg = c; };
    (globalThis as any).wx = {
      showToast: jest.fn(),
      navigateBack: jest.fn(),
      setNavigationBarTitle: jest.fn(),
      getWindowInfo: () => ({ windowWidth: 375, pixelRatio: 2 })
    };
    jest.isolateModules(() => {
      require('../pages/maintain-item-form/index');
    });

    const inst: any = {
      ...cfg,
      data: {
        ...JSON.parse(JSON.stringify(cfg.data)),
        carId: '',
        id: '',
        name: '测试项',
        cycleMileages: '10000',
        timeEnabled: false,
        timeValue: [0, 0]
      },
      setData(patch: any, cb?: () => void) {
        Object.assign(this.data, patch);
        if (typeof cb === 'function') cb();
      }
    };

    const before = a.list<any>('maintains').length;
    cfg.onSave.call(inst);
    expect(a.list<any>('maintains').length).toBe(before);
  });
});

describe('迁移边界：非法 schemaVersion 不再卡住启动', () => {
  it('schemaVersion = 0 → 不抛错，迁移到最新版本', () => {
    const a = makeAdapter();
    a.rebuildIndex();
    a.setMeta({ schemaVersion: 0 } as any);
    // 旧代码这里取 MIGRATIONS[-1] → undefined → TypeError，启动直接崩
    expect(() => runMigrations(a)).not.toThrow();
    expect(runMigrations(a)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('schemaVersion 非整数（2.5）→ 不抛错', () => {
    const a = makeAdapter();
    a.rebuildIndex();
    a.setMeta({ schemaVersion: 2.5 } as any);
    expect(() => runMigrations(a)).not.toThrow();
  });

  it('没有 schemaVersion → 按 v1 处理，跑完全部迁移', () => {
    const a = makeAdapter();
    a.rebuildIndex();
    expect(runMigrations(a)).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe('列表 key：不再用可重复的业务名称', () => {
  it('统计页分类列表用 categorySourceId', () => {
    const wxml: string = fsx.readFileSync('pages/statistics/index.wxml', 'utf-8');
    expect(wxml).toContain('wx:key="categorySourceId"');
    expect(wxml).not.toMatch(/wx:for="\{\{categories\}\}"\s+wx:key="name"/);
  });

  it('详情页保养进度用唯一 key，且视图模型里带上了它', () => {
    const wxml: string = fsx.readFileSync('pages/vehicle-detail/index.wxml', 'utf-8');
    const ts: string = fsx.readFileSync('pages/vehicle-detail/index.ts', 'utf-8');
    expect(wxml).toContain('wx:key="key"');
    expect(ts).toContain('key: p.maintain.sourceId');
  });
});

describe('车辆页：不再把 wxml 用不到的整车列表塞进 setData', () => {
  const ts: string = fsx.readFileSync('pages/index/index.ts', 'utf-8');
  const wxml: string = fsx.readFileSync('pages/index/index.wxml', 'utf-8');

  it('wxml 确实没有引用 cars', () => {
    expect(wxml).not.toMatch(/\{\{cars/);
  });

  it('setData 里不再包含整份 cars', () => {
    expect(ts).not.toMatch(/\bcars:\s*views/);
  });
});

// ---------------------------------------------------------------- 第 2 批

describe('编辑加油记录：切换能量类型时同步支出类别', () => {
  it('加油 → 充电，关联支出的类别跟着变', () => {
    const a = makeAdapter();
    useAdapter(a);
    const { car } = makeCar(a);

    const log = saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: Date.now() - 5 * DAY,
      makeMileages: 1000,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel'
    } as any);

    const fuelCat = getEnergyCategory(a, 'fuel')!;
    const evCat = getEnergyCategory(a, 'ev')!;
    expect(fuelCat.sourceId).not.toBe(evCat.sourceId);

    const costBefore = a.get<any>('costs', log.costSourceId!);
    expect(costBefore.categorySourceId).toBe(fuelCat.sourceId);

    updateRefuel(a, log.sourceId, {
      carSourceId: car.sourceId,
      fuelDate: log.fuelDate,
      makeMileages: log.makeMileages,
      unitPrice: log.unitPrice,
      volume: log.volume,
      actualPayAmount: log.actualPayAmount,
      isFull: true,
      isLowFuel: false,
      energyType: 'ev'
    } as any);

    const costAfter = a.get<any>('costs', log.costSourceId!);
    // 不改的话这笔钱会一直算在「加油」类别里，分类统计与环图长期错账
    expect(costAfter.categorySourceId).toBe(evCat.sourceId);
  });
});

describe('环图：角度按实际合计归一（避免首尾缝隙与点击错位）', () => {
  function angleRecorder() {
    const arcs: Array<{ r: number; start: number; end: number }> = [];
    const ctx: any = {
      _arcs: arcs,
      save: () => {}, restore: () => {}, scale: () => {}, beginPath: () => {},
      closePath: () => {}, moveTo: () => {}, lineTo: () => {}, fill: () => {},
      stroke: () => {}, clearRect: () => {}, fillText: () => {},
      arc: (x: number, y: number, r: number, start: number, end: number) =>
        arcs.push({ r, start, end }),
      measureText: (t: string) => ({ width: t.length * 8 })
    };
    ['fillStyle', 'strokeStyle', 'font', 'textAlign', 'textBaseline', 'lineWidth', 'globalAlpha']
      .forEach(k => Object.defineProperty(ctx, k, { get: () => '', set: () => undefined }));
    return ctx;
  }

  it('百分比合计 99.9 时，三段角度仍铺满一整圈', () => {
    const W = 319;
    const H = 186;
    const ctx = angleRecorder();
    renderDonut({
      ctx,
      w: W,
      h: H,
      segments: [
        { name: 'A', amount: '1', percent: 33.3, color: '#f00' },
        { name: 'B', amount: '1', percent: 33.3, color: '#0f0' },
        { name: 'C', amount: '1', percent: 33.3, color: '#00f' }
      ],
      total: '3',
      showLabels: false
    });

    const outerR = computeDonutLayout(W, H, 1, false).outerR;
    const outer = ctx._arcs.filter(
      (a: any) => Math.abs(a.r - outerR) < 0.01 && a.end > a.start
    );
    expect(outer.length).toBe(3);
    const sweep = outer.reduce((s: number, a: any) => s + (a.end - a.start), 0);
    // 按 percent/100 画会得到 0.999 圈（缺口约 0.36°），按合计归一才是整圈
    expect(sweep).toBeCloseTo(Math.PI * 2, 6);
  });
});

describe('月度费用：不依赖入参顺序，始终按时间升序', () => {
  it('传入降序 costs（listCosts 就是降序）时，输出仍是升序', () => {
    const a = makeAdapter();
    useAdapter(a);
    const { car, cat } = makeCar(a);

    const at = (m: number) => new Date(2026, m, 10).getTime();
    // 故意按 11 月 → 1 月 的降序传入（与 listCosts 一致）
    const costs: any[] = [10, 5, 0].map((m, i) => ({
      sourceId: `c${i}`,
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: 100,
      costDate: at(m)
    }));

    const snap = buildStats(
      { type: 'all' },
      costs as any,
      [],
      [],
      a.list<any>('categories'),
      car
    );

    expect(snap.monthlyCost.map(x => x.label)).toEqual(['1月', '6月', '11月']);
  });
});

describe('图标裁剪：图片未就绪时不得导出空白图', () => {
  const src: string = fsx.readFileSync('pages/icon-crop/index.ts', 'utf-8');

  it('导出前校验原图尺寸与视口', () => {
    expect(src).toMatch(/image not ready/);
    expect(src).toMatch(/_natural/);
    expect(src).toMatch(/viewportSize > 0/);
  });

  it('取样矩形退化为 0 时拒绝，而不是画一张空白图', () => {
    expect(src).toMatch(/invalid crop rect/);
    expect(src).toMatch(/rect\.sw > 0/);
  });
});

describe('保养项删除后不会被自动重建', () => {
  it('删光全部保养项后再进入，不会冒回默认 6 项', () => {
    const a = makeAdapter();
    useAdapter(a);
    const { car } = makeCar(a);

    ensureMaintainTemplates(a, car.sourceId);
    const seeded = listMaintains(a, car.sourceId);
    expect(seeded.length).toBeGreaterThan(0);

    seeded.forEach(m => removeMaintain(a, m.sourceId));
    expect(listMaintains(a, car.sourceId).length).toBe(0);

    // 再次进入任一入口都会调它 —— 旧实现会把 6 个默认项重新种回去
    ensureMaintainTemplates(a, car.sourceId);

    expect(listMaintains(a, car.sourceId).length).toBe(0);
    // 物理行数不变，说明确实没有新增
    expect(a.list<any>('maintains').length).toBe(seeded.length);
  });

  it('全新车辆仍然会种默认模板', () => {
    const a = makeAdapter();
    useAdapter(a);
    const { car } = makeCar(a, '新车');
    ensureMaintainTemplates(a, car.sourceId);
    expect(listMaintains(a, car.sourceId).length).toBeGreaterThan(0);
  });
});
