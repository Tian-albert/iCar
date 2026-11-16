// 测试数据可用性校验：四份样本必须能被 importBundle 正常导入并算出合理指标。
//
// 这里同时守住「保养数据要覆盖三种状态」——概览页的「保养提醒 · N 项待保养」
// 只在剩余里程 ≤500km 或剩余天数 ≤15 天才有内容，样板数据全是正常的话，
// 真机上那个区块永远是空的，等于没测。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { importBundle } from '../services/io.service';
import { listRefuels, getConsumptions } from '../services/refuel.service';
import { listCosts } from '../services/cost.service';
import { listRepairs } from '../services/repair.service';
import {
  listMaintains,
  listMaintainHandles,
  getMaintainProgress,
  MaintainProgressItem
} from '../services/maintain-record.service';
import { buildOverview } from '../services/overview.service';
import { buildStats } from '../domain/stats.service';

// 项目 tsconfig.types 只含小程序类型，Node 模块声明不可用，故用 require
const fsx = require('fs') as any;
const pathx = require('path') as any;

/**
 * 保养状态的固定基准日。
 *
 * 天周期项的「待保养」是相对当天算的，用 Date.now() 会让断言随日期漂移，
 * 所以固定在样板数据的基准日 2026-11-17。
 */
const TODAY = new Date(2026, 10, 17, 12, 0, 0).getTime();

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  };
}

function load(file: string): string {
  const p = pathx.join('test-data', file);
  if (!fsx.existsSync(p)) {
    throw new Error(`缺少测试数据文件 ${p}，请先运行 python test-data/generate.py`);
  }
  return fsx.readFileSync(p, 'utf-8');
}

function freshAdapter(): StorageAdapter {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  return adapter;
}

/** 导入并返回常用句柄（单车文件用） */
function importAndStats(file: string) {
  const adapter = freshAdapter();
  const result = importBundle(adapter, load(file));
  expect(result.ok).toBe(true);
  expect(result.added).toBeGreaterThan(0);

  const cars = adapter.list<any>('cars').filter((c: any) => !c.deleted);
  expect(cars.length).toBe(1);
  const car = cars[0];
  const refuels = listRefuels(adapter, car.sourceId);
  const segs = getConsumptions(adapter, car.sourceId);
  const costs = listCosts(adapter, car.sourceId);
  const snap = buildStats(
    { type: 'all' },
    costs,
    refuels,
    segs,
    adapter.list<any>('categories'),
    car
  );
  return { adapter, car, refuels, segs, costs, snap, result };
}

/** 取某车的保养进度（固定基准日，结果可复现） */
function progressOf(file: string): MaintainProgressItem[] {
  const adapter = freshAdapter();
  const result = importBundle(adapter, load(file));
  expect(result.ok).toBe(true);
  const car = adapter.list<any>('cars').filter((c: any) => !c.deleted)[0];
  return getMaintainProgress(adapter, car.sourceId, TODAY);
}

const overdueKm = (items: MaintainProgressItem[]) =>
  items.filter(i => i.remainMileage !== null && i.remainMileage < 0);
const overdueDays = (items: MaintainProgressItem[]) =>
  items.filter(i => i.remainDays !== null && i.remainDays < 0);
const nearDays = (items: MaintainProgressItem[]) =>
  items.filter(i => i.remainDays !== null && i.remainDays >= 0 && i.remainDays <= 15);

describe('测试数据：纯油车', () => {
  it('各类记录齐全且数量达标', () => {
    const { adapter, car, refuels, costs } = importAndStats('icar-test-fuel.json');
    expect(car.energyType).toBe('fuel');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    expect(refuels.length).toBeGreaterThanOrEqual(6);
    expect(refuels.every(r => r.energyType === 'fuel')).toBe(true);
    expect(listRepairs(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
    expect(listMaintainHandles(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
    expect(listMaintains(adapter, car.sourceId).length).toBeGreaterThan(0);
    expect(costs.length).toBeGreaterThanOrEqual(3);
  });

  it('区间与统计数值合理（油耗在乘用车常见区间）', () => {
    const { segs, snap } = importAndStats('icar-test-fuel.json');
    // 10 次加满 → 9 段有效区间
    expect(segs.length).toBe(9);
    expect(snap.fuel.avgConsumption).toBeGreaterThan(5);
    expect(snap.fuel.avgConsumption).toBeLessThan(20);
    expect(snap.mileage.fuelMileage).toBeGreaterThanOrEqual(5000);
    expect(Number.isFinite(snap.expense.total)).toBe(true);
    expect(snap.expense.total).toBeGreaterThan(0);
  });

  it('保养数据覆盖三种状态：2 项已超期 + 1 项即将到期', () => {
    const items = progressOf('icar-test-fuel.json');
    const urgent = items.filter(i => i.urgent);

    expect(urgent.length).toBe(3);
    // 一项按里程算已超期（轮胎换位 5000km 周期，实际已跑 5850km）
    expect(overdueKm(items).length).toBe(1);
    expect(overdueKm(items)[0].remainMileage).toBe(-850);
    // 一项按天数算已超期
    expect(overdueDays(items).length).toBe(1);
    expect(overdueDays(items)[0].remainDays).toBe(-81);
    // 一项即将到期
    expect(nearDays(items).length).toBe(1);
    expect(nearDays(items)[0].remainDays).toBe(13);
  });
});

describe('测试数据：纯电车', () => {
  it('充电记录与电耗指标正确，燃油指标为 0', () => {
    const { car, refuels, segs, snap } = importAndStats('icar-test-ev.json');
    expect(car.energyType).toBe('ev');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    expect(refuels.length).toBeGreaterThanOrEqual(6);
    expect(refuels.every(r => r.energyType === 'ev')).toBe(true);
    expect(segs.length).toBe(13);
    expect(segs.every(s => s.energyType === 'ev')).toBe(true);

    expect(snap.electricity.avgConsumption).toBeGreaterThan(5);
    expect(snap.electricity.avgConsumption).toBeLessThan(40);
    expect(snap.electricity.totalCost).toBeGreaterThan(0);
    expect(snap.mileage.fuelMileage).toBe(0);
    expect(snap.mileage.evMileage).toBeGreaterThanOrEqual(5000);
  });

  it('保养数据覆盖三种状态：1 项已超期 + 2 项即将到期', () => {
    const items = progressOf('icar-test-ev.json');
    expect(items.filter(i => i.urgent).length).toBe(3);
    expect(overdueDays(items).length).toBe(1);
    expect(overdueDays(items)[0].remainDays).toBe(-100);
    // 剩余 1 天与 7 天，都在 15 天阈值内
    expect(nearDays(items).length).toBe(2);
    expect(nearDays(items).map(i => i.remainDays).sort((a, b) => (a as number) - (b as number)))
      .toEqual([1, 7]);
  });
});

describe('测试数据：混动车', () => {
  it('加油与充电分别成段，油电两套指标并存', () => {
    const { adapter, car, refuels, segs, snap } = importAndStats('icar-test-hybrid.json');
    expect(car.energyType).toBe('hybrid');
    expect(car.mileages).toBeGreaterThanOrEqual(5000);

    const fuelLogs = refuels.filter(r => r.energyType === 'fuel');
    const evLogs = refuels.filter(r => r.energyType === 'ev');
    expect(fuelLogs.length).toBeGreaterThanOrEqual(6);
    expect(evLogs.length).toBeGreaterThanOrEqual(6);

    expect(segs.filter(s => s.energyType === 'fuel').length).toBeGreaterThan(0);
    expect(segs.filter(s => s.energyType === 'ev').length).toBeGreaterThan(0);

    expect(snap.fuel.avgConsumption).toBeGreaterThan(0);
    expect(snap.electricity.avgConsumption).toBeGreaterThan(0);
    expect(listRepairs(adapter, car.sourceId).length).toBeGreaterThanOrEqual(3);
  });

  it('保养数据覆盖三种状态：1 项超里程 + 1 项超天数 + 1 项即将到期', () => {
    const items = progressOf('icar-test-hybrid.json');
    expect(items.filter(i => i.urgent).length).toBe(3);
    expect(overdueKm(items).length).toBe(1);
    expect(overdueKm(items)[0].remainMileage).toBe(-400);
    expect(overdueDays(items).length).toBe(1);
    expect(overdueDays(items)[0].remainDays).toBe(-95);
    expect(nearDays(items).length).toBe(1);
    expect(nearDays(items)[0].remainDays).toBe(13);
  });
});

describe('测试数据：保养项的字段规范', () => {
  const FILES = ['icar-test-fuel.json', 'icar-test-ev.json', 'icar-test-hybrid.json'];

  it('每项都有图标（否则界面统一显示成 📌，栅格里认不出来）', () => {
    FILES.forEach(file => {
      const items = progressOf(file);
      items.forEach(i => {
        expect((i.maintain.icon || '').trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('原始 JSON 里就带图标（不是靠导入时回填兜底）', () => {
    // getMaintainProgress 会调 backfillMaintainIcons 补图标，所以上面那条断言
    // 在数据缺图标时也能通过 —— 这里直接查文件，避免样板数据退化
    [...FILES, 'icar-test-all.json'].forEach(file => {
      const bundle = JSON.parse(load(file));
      bundle.data.maintains.forEach((m: any) => {
        expect(typeof m.icon).toBe('string');
        expect(m.icon.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('cycleUnit / cycleValue 与周期一致（与 app 的 buildCycleFields 同规则）', () => {
    FILES.forEach(file => {
      progressOf(file).forEach(({ maintain: m }) => {
        if (m.cycleMonths > 0) {
          expect(m.cycleUnit).toBe('month');
          expect(m.cycleValue).toBe(m.cycleMonths);
          // 月换算成天：app 统一按 30 天/月
          expect(m.cycleDays).toBe(m.cycleMonths * 30);
        } else if (m.cycleMileages > 0) {
          expect(m.cycleUnit).toBe('km');
          expect(m.cycleValue).toBe(m.cycleMileages);
          expect(m.cycleDays).toBe(0);
        }
      });
    });
  });

  it('每项至少配了一种周期（里程或时间）', () => {
    FILES.forEach(file => {
      progressOf(file).forEach(({ maintain: m }) => {
        expect(m.cycleMileages > 0 || m.cycleMonths > 0).toBe(true);
      });
    });
  });
});

describe('测试数据：三车合并文件（验证概览页跨车区块）', () => {
  function importAll() {
    const adapter = freshAdapter();
    const result = importBundle(adapter, load('icar-test-all.json'));
    expect(result.ok).toBe(true);
    const snap = buildOverview(adapter, TODAY);
    return { adapter, snap };
  }

  it('三辆车都在，且建档后总里程正确', () => {
    const { snap } = importAll();
    expect(snap.metric.carCount).toBe(3);
    // 5850 + 5460 + 5400，三辆车 initMileages 都是 0
    expect(snap.metric.totalDrivenMileage).toBe(16710);
    expect(snap.metric.totalMileage).toBe(16710);
  });

  it('9 项待保养：概览页应显示「保养提醒 · 9 项待保养」，预览仍是 3 条', () => {
    const { snap } = importAll();
    expect(snap.pendingCount).toBe(9);
    expect(snap.maintain.length).toBe(3);
    // 排序：超期优先
    expect(snap.maintain[0].level).toBe('bad');
  });

  it('按车花费环图有三个扇区（每辆车本年都有支出）', () => {
    const { snap } = importAll();
    expect(snap.carCosts.length).toBe(3);
    expect(snap.carCosts.every(c => c.amount > 0)).toBe(true);
    expect(snap.carCosts.every((c, i, arr) => i === 0 || arr[i - 1].amount >= c.amount)).toBe(true);
    expect(snap.yearTotal).toBeGreaterThan(0);
    // 占比合计 100%
    const sum = snap.carCosts.reduce((s, c) => s + c.percent, 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.5);
  });

  it('出行成本：三辆车都有每公里成本，按成本降序', () => {
    const { snap } = importAll();
    expect(snap.drivingCosts.length).toBe(3);

    const driven = snap.drivingCosts.map(d => d.drivenKm).sort((a, b) => a - b);
    expect(driven).toEqual([5400, 5460, 5850]);

    snap.drivingCosts.forEach(d => {
      expect(d.totalSpend).toBeGreaterThan(0);
      expect(d.perKm).toBeGreaterThan(0);
      // 每公里成本 = 总花费 / 建档后里程
      expect(d.perKm).toBeCloseTo(d.totalSpend / d.drivenKm, 6);
      expect(d.days).toBeGreaterThan(0);
    });

    for (let i = 1; i < snap.drivingCosts.length; i++) {
      expect(snap.drivingCosts[i - 1].perKm).toBeGreaterThanOrEqual(snap.drivingCosts[i].perKm);
    }
  });

  it('最近记录取跨车流水的最近 3 条，且时间降序', () => {
    const { snap } = importAll();
    expect(snap.recent.length).toBe(3);
    for (let i = 1; i < snap.recent.length; i++) {
      expect(snap.recent[i - 1].date).toBeGreaterThanOrEqual(snap.recent[i].date);
    }
  });
});

describe('测试数据：四份文件都可重复导入（幂等）', () => {
  it.each(['icar-test-fuel.json', 'icar-test-ev.json', 'icar-test-hybrid.json', 'icar-test-all.json'])(
    '%s 重复导入不产生重复记录',
    file => {
      const adapter = freshAdapter();
      const json = load(file);

      const first = importBundle(adapter, json);
      expect(first.ok).toBe(true);
      const countAfterFirst = adapter.list<any>('fuelRecords').length;

      const second = importBundle(adapter, json);
      expect(second.ok).toBe(true);
      // 第二次应全部 skipped（updatedAt 相等）
      expect(second.added).toBe(0);
      expect(adapter.list<any>('fuelRecords').length).toBe(countAfterFirst);
    }
  );
});

describe('测试数据：合并文件与单车文件不冲突', () => {
  it('先导入合并文件再导入单车文件，车辆数仍是 3（sourceId 相同被幂等跳过）', () => {
    const adapter = freshAdapter();
    expect(importBundle(adapter, load('icar-test-all.json')).ok).toBe(true);
    const carsAfterAll = adapter.list<any>('cars').filter((c: any) => !c.deleted).length;
    expect(carsAfterAll).toBe(3);

    expect(importBundle(adapter, load('icar-test-fuel.json')).ok).toBe(true);
    const carsAfterSingle = adapter.list<any>('cars').filter((c: any) => !c.deleted).length;
    expect(carsAfterSingle).toBe(3);
  });
});
