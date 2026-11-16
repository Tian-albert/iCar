// 1.1.1 发布前审计修复的回归测试
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import { saveRefuel } from '../services/refuel.service';
import { listCosts } from '../services/cost.service';
import {
  addMaintain,
  saveMaintainHandle,
  listMaintainHandles,
  listMaintainLogs,
  updateMaintainHandle
} from '../services/maintain-record.service';
import { listRecycleBatches } from '../services/recycle.service';
import { buildShareCardModel, computeShareCardLayout, ShareCardInput } from '../utils/share-card';
import { resolveExportDpr, MAX_CANVAS_EDGE } from '../utils/share-card-draw';

const fsx = require('fs') as any;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); }
  } as any;
}

function setup() {
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: '审计车',
    mileages: 0,
    initDate: Date.now(),
    energyType: 'fuel'
  });
  return { adapter, car };
}

describe('编辑保养记录不污染回收站', () => {
  it('重建明细用物理删除，不产生孤立删除批次', () => {
    const { adapter, car } = setup();
    const m = addMaintain(adapter, car.sourceId, {
      name: '机油机滤',
      cycleMileages: 10000,
      timeUnit: '',
      timeValue: 0
    });

    // 第一次记录：选 1 个保养项
    const handle = saveMaintainHandle(adapter, {
      carSourceId: car.sourceId,
      maintainSourceIds: [m.sourceId],
      makeDate: Date.now(),
      makeMileages: 1000,
      amount: 500
    });

    const before = listRecycleBatches(adapter).length;

    // 编辑同一条记录：改成选同一个项（内部会重建 logs）
    updateMaintainHandle(adapter, handle.sourceId, {
      carSourceId: car.sourceId,
      maintainSourceIds: [m.sourceId],
      makeDate: Date.now(),
      makeMileages: 1200,
      amount: 520
    });

    const after = listRecycleBatches(adapter).length;
    // 旧实现会为每条旧 log 生成独立批次，导致回收站条目增加
    expect(after).toBe(before);

    // 明细应仍只有 1 条（重建后）
    expect(listMaintainLogs(adapter, car.sourceId).length).toBe(1);
  });

  it('保养记录本身仍在，未被误删', () => {
    const { adapter, car } = setup();
    const m = addMaintain(adapter, car.sourceId, {
      name: '空调滤芯',
      cycleMileages: 20000,
      timeUnit: '',
      timeValue: 0
    });
    const handle = saveMaintainHandle(adapter, {
      carSourceId: car.sourceId,
      maintainSourceIds: [m.sourceId],
      makeDate: Date.now(),
      makeMileages: 1000,
      amount: 300
    });
    updateMaintainHandle(adapter, handle.sourceId, {
      carSourceId: car.sourceId,
      maintainSourceIds: [m.sourceId],
      makeDate: Date.now(),
      makeMileages: 1500,
      amount: 320
    });
    const handles = listMaintainHandles(adapter, car.sourceId);
    expect(handles.length).toBe(1);
    expect(handles[0].makeMileages).toBe(1500);
  });
});

describe('分享卡片：分类截断有明确提示', () => {
  function input(catCount: number): ShareCardInput {
    return {
      carName: 'X',
      energyType: 'fuel',
      rangeLabel: '2026年',
      hasData: true,
      mileage: { latest: 1000, increased: 1000, fuelMileage: 1000, evMileage: 0 },
      fuel: { totalCost: 100, avgConsumption: 8, costPerKm: 0.1 },
      electricity: { totalCost: 0, avgConsumption: 0, costPerKm: 0 },
      expense: { total: 500, perKm: 0.5, perKmExFuel: 0.4 },
      categories: Array.from({ length: catCount }, (_, i) => ({
        name: `C${i}`,
        amount: 100 - i,
        percent: 10,
        color: '#3B6FF6'
      })),
      trendUnit: 'L/100km',
      trend: [],
      monthlyMileage: [],
      monthlyCost: []
    };
  }

  it('超过上限时记录被隐藏的条数', () => {
    const m = buildShareCardModel(input(9), 'brief');
    expect(m.categoryRows.length).toBe(6);
    expect(m.categoryHiddenCount).toBe(3);
  });

  it('未超限时隐藏数为 0', () => {
    const m = buildShareCardModel(input(4), 'brief');
    expect(m.categoryHiddenCount).toBe(0);
  });

  it('有隐藏项时分类卡更高（为提示行留空间）', () => {
    const few = computeShareCardLayout(buildShareCardModel(input(4), 'brief'));
    const many = computeShareCardLayout(buildShareCardModel(input(9), 'brief'));
    expect(many.height).toBeGreaterThan(few.height);
  });
});

describe('导出尺寸：取样区必须用物理像素', () => {
  it('逻辑高 3000px 时 dpr 被压到不超上限', () => {
    const dpr = resolveExportDpr(750, 3000, 3);
    expect(750 * dpr).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
    expect(3000 * dpr).toBeLessThanOrEqual(MAX_CANVAS_EDGE);
    // 若用逻辑值作为 width 传给 canvasToTempFilePath，只会取到左上 1/dpr
    expect(dpr).toBeLessThan(2);
  });
});

describe('版本号一致性', () => {
  it('四个位置版本号一致', () => {
    const about = fsx.readFileSync('pages/about/index.ts', 'utf-8');
    const user = fsx.readFileSync('pages/user/index.wxml', 'utf-8');
    const io = fsx.readFileSync('services/io.service.ts', 'utf-8');
    const pkg = JSON.parse(fsx.readFileSync('package.json', 'utf-8'));

    const m = /version:\s*'([\d.]+)'/.exec(about);
    expect(m).not.toBeNull();
    const v = m![1];

    expect(user).toContain(`v${v}`);
    expect(io).toContain(`appVersion: '${v}'`);
    expect(pkg.version).toBe(v);
  });
});
