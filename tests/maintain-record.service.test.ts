// 保养记录服务单测：模板 seed + 保养执行保存 + 进度计算
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import {
  ensureMaintainTemplates,
  listMaintains,
  saveMaintainHandle,
  getMaintainProgress,
  formatCycle,
  addMaintain,
  updateMaintainCycle,
  getMaintain,
  getMaintainThresholds,
  setMaintainThresholds
} from '../services/maintain-record.service';
import { listCosts } from '../services/cost.service';
import { Maintain } from '../types/models';

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
  const adapter = new StorageAdapter(createMemoryStorage());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: 'CRV',
    mileages: 2908,
    initMileages: 0,
    initDate: new Date(2026, 4, 24).getTime(),
    energyType: 'fuel'
  });
  return { adapter, car };
}

describe('maintain-record.service 保养项模板', () => {
  it('首次访问 seed 6 个默认保养项，且幂等', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const names = listMaintains(adapter, car.sourceId).map(m => m.name);
    expect(names).toEqual(['机油机滤', '空调滤芯', '空气滤芯', '刹车油', '火花塞', '变速箱油']);

    ensureMaintainTemplates(adapter, car.sourceId); // 再次调用不重复
    expect(listMaintains(adapter, car.sourceId).length).toBe(6);
  });
});

describe('maintain-record.service 保养执行', () => {
  it('记保养 → 生成 Handle + N 条 Log + 保养类支出', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const maintains = listMaintains(adapter, car.sourceId);
    const ids = maintains.filter(m => ['机油机滤', '空调滤芯'].includes(m.name)).map(m => m.sourceId);

    saveMaintainHandle(adapter, {
      carSourceId: car.sourceId,
      maintainSourceIds: ids,
      makeDate: new Date(2026, 7, 13).getTime(),
      makeMileages: 1534,
      amount: 568,
      remark: '首保'
    });

    expect(adapter.list<any>('maintainHandles').filter(h => !h.deleted).length).toBe(1);
    expect(adapter.list<any>('maintainLogs').filter(l => !l.deleted).length).toBe(2);
    const costs = listCosts(adapter, car.sourceId);
    expect(costs.length).toBe(1);
    expect(costs[0].amount).toBe(568);
  });
});

describe('maintain-record.service 保养进度', () => {
  it('机油机滤（已保养 1534km/2026-08-13）→ 剩余 8626km / 291 天', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const oil = listMaintains(adapter, car.sourceId).find(m => m.name === '机油机滤')!;
    saveMaintainHandle(adapter, {
      carSourceId: car.sourceId,
      maintainSourceIds: [oil.sourceId],
      makeDate: new Date(2026, 7, 13).getTime(),
      makeMileages: 1534,
      amount: null
    });

    const today = new Date(2026, 9, 21).getTime();
    const progress = getMaintainProgress(adapter, car.sourceId, today);
    const oilP = progress.find(p => p.maintain.name === '机油机滤')!;
    expect(oilP.remainMileage).toBe(8626);
    expect(oilP.remainDays).toBe(291);

    // 空气滤芯（无保养记录）→ 剩余 17092km
    const air = progress.find(p => p.maintain.name === '空气滤芯')!;
    expect(air.remainMileage).toBe(17092);
    expect(air.remainDays).toBeNull();
  });
});

describe('maintain-record.service 保养周期', () => {
  it('formatCycle 周期文本（月/年换算）', () => {
    expect(formatCycle({ cycleMileages: 10000, cycleMonths: 12, cycleDays: 360 } as Maintain)).toBe('10000km / 12月');
    expect(formatCycle({ cycleMileages: 20000, cycleMonths: 0, cycleDays: 0 } as Maintain)).toBe('20000km');
    expect(formatCycle({ cycleMileages: 0, cycleMonths: 12, cycleDays: 360 } as Maintain)).toBe('12月');
    expect(formatCycle({ cycleMileages: 40000, cycleMonths: 48, cycleDays: 1440 } as Maintain)).toBe('40000km / 4年');
    expect(formatCycle({ cycleMileages: 20000, cycleMonths: 24, cycleDays: 720 } as Maintain)).toBe('20000km / 2年');
  });

  it('添加自定义保养项 + 修改周期（月/年单位换算成月存储）', () => {
    const { adapter, car } = setup();
    const m = addMaintain(adapter, car.sourceId, { name: '轮胎', cycleMileages: 50000, timeUnit: '', timeValue: 0 });
    expect(m.cycleMileages).toBe(50000);
    expect(m.cycleMonths).toBe(0);

    updateMaintainCycle(adapter, m.sourceId, { name: '轮胎', cycleMileages: 60000, timeUnit: 'year', timeValue: 3 });
    const updated = getMaintain(adapter, m.sourceId)!;
    expect(updated.cycleMileages).toBe(60000);
    expect(updated.cycleMonths).toBe(36); // 3 年 = 36 月
    expect(updated.cycleDays).toBe(1080); // 36 月 × 30 天

    updateMaintainCycle(adapter, m.sourceId, { name: '轮胎', cycleMileages: 60000, timeUnit: 'month', timeValue: 8 });
    expect(getMaintain(adapter, m.sourceId)!.cycleMonths).toBe(8); // 8 月
  });
});

describe('maintain-record.service 保养提醒阈值', () => {
  it('默认阈值 500km / 15 天，按车单独设置', () => {
    const { adapter, car } = setup();
    expect(getMaintainThresholds(adapter, car.sourceId)).toEqual({ mileage: 500, days: 15 });

    setMaintainThresholds(adapter, car.sourceId, 2000, 30);
    expect(getMaintainThresholds(adapter, car.sourceId)).toEqual({ mileage: 2000, days: 30 });
  });

  it('阈值影响 urgent 判定（剩余里程 ≤ 阈值）', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const today = new Date(2026, 9, 21).getTime();
    const { calcRemaining } = require('../domain/maintain.service') as typeof import('../domain/maintain.service');
    const m = listMaintains(adapter, car.sourceId).find(x => x.name === '空气滤芯')!;
    const lowCar = { ...car, mileages: 19550 }; // 空气滤芯 20000km → 剩余 450km

    expect(calcRemaining(m, null, lowCar, today, { mileage: 500, days: 15 }).urgent).toBe(true); // 450 ≤ 500
    expect(calcRemaining(m, null, lowCar, today, { mileage: 100, days: 15 }).urgent).toBe(false); // 450 > 100
  });
});
