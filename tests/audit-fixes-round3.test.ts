// 第三轮审计（第 3 批）的回归测试。
//
// 两项结构性改动：
// 1. 覆盖导入「先校验后清空」—— 校验不过时旧数据必须原样保留
// 2. 概览汇总「一次取全表再分组」—— 结果必须与逐车查询完全一致
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { listCategories, saveCost, listCosts } from '../services/cost.service';
import { saveRefuel } from '../services/refuel.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  getMaintainProgress,
  getMaintainProgressBatch,
  saveMaintainHandle
} from '../services/maintain-record.service';
import { buildOverview } from '../services/overview.service';
import { importBundle, exportBundle } from '../services/io.service';

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
  return a;
}

function manifest(data: Record<string, unknown>): string {
  return JSON.stringify({ format: 'icar-export', version: 1, data });
}

/** 建一辆车 + 类别，可选加支出 */
function seed(a: StorageAdapter, name: string, spend = 0) {
  seedPresetCategories(a);
  const car = createCar(a, {
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
  const cat = listCategories(a)[0];
  if (spend > 0) {
    saveCost(a, {
      carSourceId: car.sourceId,
      categorySourceId: cat.sourceId,
      amount: spend,
      costDate: Date.now() - DAY
    } as any);
  }
  return { car, cat };
}

// ---------------------------------------------------------------- S1 覆盖导入

describe('覆盖导入：校验前置，失败不丢旧数据', () => {
  it('JSON 解析失败 → 旧数据完整保留', () => {
    const a = makeAdapter();
    const { car } = seed(a, '旧车', 500);
    const before = listCosts(a, car.sourceId).length;

    const r = importBundle(a, '{ 这不是 json', 'replace');

    expect(r.ok).toBe(false);
    expect(listCosts(a, car.sourceId).length).toBe(before);
    expect(a.get<any>('cars', car.sourceId)).not.toBeNull();
  });

  it('不是 iCar 导出格式 → 旧数据完整保留', () => {
    const a = makeAdapter();
    const { car } = seed(a, '旧车', 500);
    const before = listCosts(a, car.sourceId).length;

    const r = importBundle(a, JSON.stringify({ format: 'other', data: {} }), 'replace');

    expect(r.ok).toBe(false);
    expect(listCosts(a, car.sourceId).length).toBe(before);
  });

  it('某张表不是数组 → 旧数据完整保留', () => {
    const a = makeAdapter();
    const { car } = seed(a, '旧车', 500);
    const before = listCosts(a, car.sourceId).length;

    const r = importBundle(a, manifest({ cars: 'oops' }), 'replace');

    expect(r.ok).toBe(false);
    expect(listCosts(a, car.sourceId).length).toBe(before);
    expect(a.get<any>('cars', car.sourceId)).not.toBeNull();
  });

  it('清空发生在校验通过之后：合法备份仍会清掉旧数据', () => {
    const a = makeAdapter();
    seed(a, '旧车', 500);
    const oldCarCount = a.list<any>('cars').length;
    expect(oldCarCount).toBe(1);

    // 一份只有一辆新车的合法备份
    const fresh = makeAdapter();
    const { car: newCar } = seed(fresh, '新车', 100);
    const json = exportBundle(fresh);

    const r = importBundle(a, json, 'replace');
    expect(r.ok).toBe(true);
    expect(r.cleared).toBeGreaterThan(0);

    const cars = a.list<any>('cars').filter((c: any) => !c.deleted);
    expect(cars.length).toBe(1);
    expect(cars[0].sourceId).toBe(newCar.sourceId);
  });

  it('写入阶段抛错 → 旧数据被回滚，不会两头空', () => {
    const a = makeAdapter();
    const { car } = seed(a, '旧车', 500);
    const beforeCosts = listCosts(a, car.sourceId).length;
    expect(beforeCosts).toBeGreaterThan(0);

    // 一份合法备份（能通过全部校验），但让落库时抛错
    const fresh = makeAdapter();
    seed(fresh, '新车', 100);
    const json = exportBundle(fresh);

    const original = a.insert.bind(a);
    let calls = 0;
    (a as any).insert = (table: string, entity: any) => {
      calls++;
      // 只让第 3 次写入失败（模拟瞬时故障）：回滚本身也要写库，
      // 若持续抛错那是「连回滚都失败」的另一种情况，下面单独断言
      if (calls === 3) throw new Error('storage quota exceeded');
      return original(table, entity);
    };

    const r = importBundle(a, json, 'replace');
    (a as any).insert = original;

    expect(r.ok).toBe(false);
    // 关键：旧数据必须还在（只提前校验是挡不住写入阶段故障的）
    expect(a.get<any>('cars', car.sourceId)).not.toBeNull();
    expect(listCosts(a, car.sourceId).length).toBe(beforeCosts);
  });

  it('回滚后提示文案说明已恢复，而不是「可能未完整导入」', () => {
    const a = makeAdapter();
    seed(a, '旧车', 500);

    const fresh = makeAdapter();
    seed(fresh, '新车', 100);
    const json = exportBundle(fresh);

    const original = a.insert.bind(a);
    (a as any).insert = () => { throw new Error('boom'); };
    const r = importBundle(a, json, 'replace');
    (a as any).insert = original;

    expect(r.ok).toBe(false);
    expect(r.message).toContain('恢复');
  });

  it('合并模式不清空（与覆盖模式的差异保持不变）', () => {
    const a = makeAdapter();
    const { car: oldCar } = seed(a, '旧车', 500);

    const fresh = makeAdapter();
    seed(fresh, '新车', 100);
    const json = exportBundle(fresh);

    const r = importBundle(a, json, 'merge');
    expect(r.ok).toBe(true);
    expect(r.cleared).toBe(0);
    // 两辆车都在
    expect(a.list<any>('cars').filter((c: any) => !c.deleted).length).toBe(2);
    expect(a.get<any>('cars', oldCar.sourceId)).not.toBeNull();
  });
});

describe('覆盖导入：悬空引用被断开而不是丢记录', () => {
  it('支出的类别不存在 → 清空 categorySourceId，但金额仍在', () => {
    const a = makeAdapter();
    seedPresetCategories(a);

    const r = importBundle(
      a,
      manifest({
        cars: [{ sourceId: 'mp:cars:x', name: 'X', mileages: 100, initMileages: 0, updatedAt: 1 }],
        costs: [
          {
            sourceId: 'mp:costs:orphan',
            carSourceId: 'mp:cars:x',
            categorySourceId: 'mp:category:不存在',
            amount: 88,
            costDate: Date.now(),
            updatedAt: 1
          }
        ]
      }),
      'replace'
    );

    expect(r.ok).toBe(true);
    const cost = a.get<any>('costs', 'mp:costs:orphan');
    // 记录必须留下（导入就是为了保住数据）
    expect(cost).not.toBeNull();
    expect(cost.amount).toBe(88);
    // 悬空的次级引用被断开，避免统计里算进「看不见的类别」
    expect(cost.categorySourceId).toBe('');
  });

  it('加油记录指向不存在的支出 → 清空 costSourceId，记录保留', () => {
    const a = makeAdapter();
    seedPresetCategories(a);

    const r = importBundle(
      a,
      manifest({
        cars: [{ sourceId: 'mp:cars:y', name: 'Y', mileages: 100, initMileages: 0, updatedAt: 1 }],
        fuelRecords: [
          {
            sourceId: 'mp:refuel:orphan',
            carSourceId: 'mp:cars:y',
            energyType: 'fuel',
            fuelDate: Date.now(),
            makeMileages: 100,
            volume: 30,
            unitPrice: 7.5,
            isFull: true,
            costSourceId: 'mp:costs:不存在',
            updatedAt: 1
          }
        ]
      }),
      'replace'
    );

    expect(r.ok).toBe(true);
    const log = a.get<any>('fuelRecords', 'mp:refuel:orphan');
    expect(log).not.toBeNull();
    expect(log.volume).toBe(30);
    expect(log.costSourceId).toBe('');
  });

  it('引用有效的记录不受影响', () => {
    const a = makeAdapter();
    const src = makeAdapter();
    const { car } = seed(src, '有车', 200);
    const json = exportBundle(src);

    const r = importBundle(a, json, 'replace');
    expect(r.ok).toBe(true);

    const costs = a.list<any>('costs').filter((c: any) => c.carSourceId === car.sourceId);
    expect(costs.length).toBeGreaterThan(0);
    // 类别引用必须还在（不能因为校验逻辑误清）
    expect(costs[0].categorySourceId).not.toBe('');
  });

  it('carSourceId 悬空的记录仍然保留（不静默丢用户数据）', () => {
    const a = makeAdapter();
    seedPresetCategories(a);

    const r = importBundle(
      a,
      manifest({
        costs: [
          {
            sourceId: 'mp:costs:no-car',
            carSourceId: 'mp:cars:不存在',
            categorySourceId: '',
            amount: 66,
            costDate: Date.now(),
            updatedAt: 1
          }
        ]
      }),
      'replace'
    );

    expect(r.ok).toBe(true);
    // 丢弃整条会静默损失数据；原样保留，等对应的车之后被导入时还能归位
    expect(a.get<any>('costs', 'mp:costs:no-car')).not.toBeNull();
  });
});

// ---------------------------------------------------------------- M8 概览汇总

describe('概览汇总：批量查询与逐车查询结果一致', () => {
  function buildThreeCars(a: StorageAdapter) {
    seedPresetCategories(a);
    const now = Date.now();
    const made: Array<{ id: string; spend: number }> = [];

    [
      { name: 'A', spend: 3000, days: 400 },
      { name: 'B', spend: 1500, days: 200 },
      { name: 'C', spend: 800, days: 100 }
    ].forEach(x => {
      const car = createCar(a, {
        name: x.name,
        mileages: 20000,
        initMileages: 5000,
        initDate: now - x.days * DAY,
        icon: 'car',
        energyType: 'fuel',
        batteryCapacity: 0,
        maintainSoonMileage: 500,
        maintainSoonDays: 15
      } as any);
      const cat = listCategories(a)[0];
      saveCost(a, {
        carSourceId: car.sourceId,
        categorySourceId: cat.sourceId,
        amount: x.spend,
        costDate: now - DAY
      } as any);
      ensureMaintainTemplates(a, car.sourceId);
      made.push({ id: car.sourceId, spend: x.spend });
    });
    return { made, now };
  }

  it('每车的保养进度与 getMaintainProgress 完全一致', () => {
    const a = makeAdapter();
    const { made, now } = buildThreeCars(a);
    const ids = made.map(m => m.id);

    const batch = getMaintainProgressBatch(a, ids, now);
    ids.forEach(id => {
      const single = getMaintainProgress(a, id, now);
      expect(batch[id].length).toBe(single.length);
      single.forEach((s, i) => {
        const b = batch[id][i];
        // 顺序（sortOrder → createdAt）也必须一致
        expect(b.maintain.sourceId).toBe(s.maintain.sourceId);
        expect(b.remainMileage).toBe(s.remainMileage);
        expect(b.remainDays).toBe(s.remainDays);
        expect(b.urgent).toBe(s.urgent);
        expect(b.progress).toBeCloseTo(s.progress, 10);
      });
    });
  });

  it('概览的各项汇总值正确', () => {
    const a = makeAdapter();
    const { made, now } = buildThreeCars(a);
    const snap = buildOverview(a, now);

    expect(snap.metric.carCount).toBe(3);
    // 20000 × 3；建档后 = (20000−5000) × 3
    expect(snap.metric.totalMileage).toBe(60000);
    expect(snap.metric.totalDrivenMileage).toBe(45000);
    expect(snap.yearTotal).toBe(3000 + 1500 + 800);
    expect(snap.carCosts.length).toBe(3);
    expect(snap.drivingCosts.length).toBe(3);
    // 每公里成本 = 花费 / 建档后里程
    made.forEach(m => {
      const d = snap.drivingCosts.filter(x => x.carSourceId === m.id)[0];
      expect(d.perKm).toBeCloseTo(m.spend / 15000, 8);
    });
  });

  it('本月 / 今年支出只算范围内，且不重复累加', () => {
    const a = makeAdapter();
    const now = Date.now();
    seedPresetCategories(a);
    const car = createCar(a, {
      name: 'A', mileages: 10000, initMileages: 0,
      initDate: now - 400 * DAY, icon: 'car',
      energyType: 'fuel', batteryCapacity: 0,
      maintainSoonMileage: 500, maintainSoonDays: 15
    } as any);
    const cat = listCategories(a)[0];
    const d = new Date(now);
    const thisMonth = new Date(d.getFullYear(), d.getMonth(), 2).getTime();
    const lastYear = new Date(d.getFullYear() - 1, 5, 1).getTime();

    saveCost(a, { carSourceId: car.sourceId, categorySourceId: cat.sourceId, amount: 100, costDate: thisMonth } as any);
    saveCost(a, { carSourceId: car.sourceId, categorySourceId: cat.sourceId, amount: 200, costDate: lastYear } as any);

    const snap = buildOverview(a, now);
    expect(snap.metric.monthCost).toBe(100);
    expect(snap.yearTotal).toBe(100);
    // 全时段出行成本包含去年那笔
    expect(snap.drivingCosts[0].totalSpend).toBe(300);
  });

  it('加油自动生成的支出不会被重复计入（只从 Cost 汇总）', () => {
    const a = makeAdapter();
    const now = Date.now();
    seedPresetCategories(a);
    const car = createCar(a, {
      name: 'A', mileages: 10000, initMileages: 0,
      initDate: now - 100 * DAY, icon: 'car',
      energyType: 'fuel', batteryCapacity: 0,
      maintainSoonMileage: 500, maintainSoonDays: 15
    } as any);

    saveRefuel(a, {
      carSourceId: car.sourceId,
      fuelDate: now - DAY,
      makeMileages: 9000,
      unitPrice: 7.5,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel'
    } as any);

    const snap = buildOverview(a, now);
    // 7.5 × 40 = 300，只应算一次
    expect(snap.yearTotal).toBe(300);
    expect(snap.drivingCosts[0].totalSpend).toBe(300);
  });

  it('车辆被物理删除后不再抛错（批量查询跳过不存在的车）', () => {
    const a = makeAdapter();
    const { made, now } = buildThreeCars(a);
    const gone = made[0].id;

    a.hardDelete('cars', gone);
    // 保养项还在，但车没了
    expect(() => getMaintainProgressBatch(a, [gone, made[1].id], now)).not.toThrow();

    const batch = getMaintainProgressBatch(a, [gone, made[1].id], now);
    expect(batch[gone]).toEqual([]);
    expect(batch[made[1].id].length).toBeGreaterThan(0);
  });

  it('空车列表不抛错', () => {
    const a = makeAdapter();
    expect(getMaintainProgressBatch(a, [], Date.now())).toEqual({});
    expect(() => buildOverview(a, Date.now())).not.toThrow();
  });

  it('批量查询只扫一遍日志表（用 list 调用次数验证）', () => {
    const a = makeAdapter();
    const { made, now } = buildThreeCars(a);

    const original = a.list.bind(a);
    const counts: Record<string, number> = {};
    (a as any).list = (table: string) => {
      counts[table] = (counts[table] || 0) + 1;
      return original(table);
    };

    getMaintainProgressBatch(a, made.map(m => m.id), now);

    // 旧实现是「每车各扫一遍」，3 辆车会各 2 次以上
    expect(counts['maintainLogs'] || 0).toBe(1);
    expect(counts['maintainHandles'] || 0).toBe(1);
    expect(counts['maintains'] || 0).toBe(1);
  });
});

describe('保养记录保存后进度仍然正确（批量重构没有改变语义）', () => {
  it('做一次保养后剩余量按新的基线重算', () => {
    const a = makeAdapter();
    const now = Date.now();
    seedPresetCategories(a);
    const car = createCar(a, {
      name: 'A', mileages: 20000, initMileages: 0,
      initDate: now - 200 * DAY, icon: 'car',
      energyType: 'fuel', batteryCapacity: 0,
      maintainSoonMileage: 500, maintainSoonDays: 15
    } as any);
    ensureMaintainTemplates(a, car.sourceId);

    const oil = listMaintains(a, car.sourceId).filter(m => m.name === '机油机滤')[0];
    expect(oil).toBeTruthy();

    const before = getMaintainProgress(a, car.sourceId, now).filter(
      p => p.maintain.sourceId === oil.sourceId
    )[0];
    expect(before.remainMileage).toBe(10000 - 20000);

    saveMaintainHandle(a, {
      carSourceId: car.sourceId,
      maintainSourceIds: [oil.sourceId],
      makeDate: now - DAY,
      makeMileages: 20000,
      amount: 500
    } as any);

    const after = getMaintainProgress(a, car.sourceId, now).filter(
      p => p.maintain.sourceId === oil.sourceId
    )[0];
    expect(after.remainMileage).toBe(10000);
    // 批量接口给出同样的结果
    const batchAll = getMaintainProgressBatch(a, [car.sourceId], now)[car.sourceId];
    const batch = batchAll.filter(p => p.maintain.sourceId === oil.sourceId)[0];
    expect(batch.remainMileage).toBe(after.remainMileage);
  });
});

describe('第 3 批的实现契约', () => {
  const io: string = fsx.readFileSync('services/io.service.ts', 'utf-8');
  const overview: string = fsx.readFileSync('services/overview.service.ts', 'utf-8');

  it('覆盖导入的 clearTables 在校验之后才调用', () => {
    const clearIdx = io.indexOf('cleared = clearTables(');
    const stageIdx = io.indexOf('const staged:');
    const refIdx = io.indexOf('const REFS:');
    expect(clearIdx).toBeGreaterThan(0);
    expect(stageIdx).toBeGreaterThan(0);
    expect(refIdx).toBeGreaterThan(0);
    // 顺序：先暂存净化 → 再校验引用 → 最后才清空
    expect(stageIdx).toBeLessThan(clearIdx);
    expect(refIdx).toBeLessThan(clearIdx);
  });

  it('概览页不再在按车循环里逐车查表', () => {
    // 循环体内不应再出现 listCosts / listRefuels / getMaintainProgress
    const loopStart = overview.indexOf('for (const car of cars)');
    expect(loopStart).toBeGreaterThan(0);
    const loopBody = overview.slice(loopStart, overview.indexOf('// 待保养：', loopStart));
    expect(loopBody).not.toContain('listCosts(storage');
    expect(loopBody).not.toContain('listRefuels(storage');
    expect(loopBody).not.toContain('getMaintainProgress(storage');
    // 改为从预分组的结果里取
    expect(loopBody).toContain('costsByCar.get');
    expect(loopBody).toContain('progressByCar[');
  });
});
