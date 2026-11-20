// 演示数据预置服务（仅开发 / 体验环境）
//
// 目的：评测工具、体验版、给朋友演示时，模拟器/新环境里没有任何本地数据，
// 所有查询类原子接口只能回答「还没有车辆」，评测与演示都没法看。
// 这里在**完全空库**的开发 / 体验环境里，通过**真实服务链路**造一套演示数据——
// 不塞裸数据：加油走 saveRefuel（联动支出 + 区间重算 + 里程回写），
// 保养走 addMaintain / saveMaintainHandle，保证派生数据（油耗区间、剩余量）与 App 完全同源。
//
// 三道闸保证安全：
//   ① envVersion === 'release' 永不注入（正式版用户的隐私承诺不破）；
//   ② 已有车辆不注入（不覆盖真机上的真实数据）；
//   ③ meta.demoSeededAt 已存在不注入（用户删光演示数据 = 想要空库，尊重）。
import { StorageAdapter } from '../repositories/storage.adapter';
import { Car } from '../types/models';
import { createCar } from './car.service';
import { saveCost } from './cost.service';
import { addMaintain, saveMaintainHandle } from './maintain-record.service';
import { saveRefuel } from './refuel.service';
import { serviceError } from './service-error';

/** 小程序运行环境（与 wx.getAccountInfoSync().miniProgram.envVersion 对齐） */
export type MiniEnv = 'develop' | 'trial' | 'release';

/** 一天内第 n 天前的时刻（统一取中午，避免跨日边界影响「今天/昨天」语义） */
function daysAgo(n: number): number {
  const d = new Date(Date.now() - n * 86400000);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

/**
 * 相对当前月份偏移 offset 个月的第 day 天（day 越界自动收敛到月末；当月不越过今天）。
 * 保证「这个月 / 上个月」的查询永远有数据，无论评测在哪一天跑。
 */
function atMonth(offset: number, day: number): number {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1, 12, 0, 0, 0);
  const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let effectiveDay = Math.min(day, maxDay);
  if (offset === 0) effectiveDay = Math.min(effectiveDay, now.getDate());
  d.setDate(effectiveDay);
  if (offset === 0 && d.getTime() > now.getTime()) d.setTime(now.getTime());
  return d.getTime();
}

/**
 * 空库的开发 / 体验环境注入演示数据。
 *
 * @returns 是否真正注入（false = 被三道闸之一挡下）
 */
export function seedDemoDataIfNeeded(storage: StorageAdapter, envVersion: string | undefined): boolean {
  // 闸 1：正式版永不注入
  if (envVersion === 'release') return false;
  // 闸 2：已有车辆说明是真实数据，不覆盖
  if (storage.list<Car>('cars').some(c => !c.deleted)) return false;

  const meta = storage.getMeta<{ schemaVersion?: number; demoSeededAt?: number }>();
  // 闸 3：注入过一次就不再来（用户删光演示数据 = 想要空库）
  if (meta.demoSeededAt) return false;
  // 迁移未完成时不写（此时各表 schema 可能还是旧格式）
  if (!meta.schemaVersion) return false;

  seedDemoData(storage);
  // 展开合并：meta 里还有 schemaVersion 等字段，整体覆盖会抹掉迁移版本号
  storage.setMeta({ ...meta, demoSeededAt: Date.now() });
  return true;
}

/** 通过真实服务链路造数据：3 辆车 + 保养（一红一橙）+ 加油/充电（有区间）+ 10 笔支出 */
function seedDemoData(storage: StorageAdapter): void {
  const categories = storage
    .list<{ sourceId: string; name: string; deleted?: boolean }>('categories')
    .filter(c => !c.deleted);
  const catByName = (name: string): string => {
    const hit = categories.find(c => c.name === name);
    if (!hit) throw serviceError(`演示数据缺少「${name}」预设类别，请先在支出类别管理里恢复预设`);
    return hit.sourceId;
  };

  // ---------- 车辆：燃油 + 纯电 + 混动 ----------
  const crv = createCar(storage, {
    name: '我的 CRV',
    mileages: 12600,
    initMileages: 0,
    initDate: daysAgo(400),
    energyType: 'fuel',
    icon: '🚗'
  });
  const p7 = createCar(storage, {
    name: '小鹏 P7',
    mileages: 15550,
    initMileages: 8000,
    initDate: daysAgo(380),
    energyType: 'ev',
    batteryCapacity: 80,
    icon: '🚙'
  });
  const tang = createCar(storage, {
    name: '唐 DM-i',
    mileages: 9800,
    initMileages: 0,
    initDate: daysAgo(360),
    energyType: 'hybrid',
    batteryCapacity: 22,
    icon: '🚐'
  });

  // ---------- 加油 / 充电（走 saveRefuel：联动支出 + 区间重算 + 里程回写） ----------
  // CRV：两次连续加满 + 一条油量低，产出两段有效油耗区间
  saveRefuel(storage, {
    carSourceId: crv.sourceId,
    fuelDate: daysAgo(60),
    makeMileages: 11450,
    unitPrice: 7.85,
    volume: 40,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    remark: '中石化 92 号'
  });
  saveRefuel(storage, {
    carSourceId: crv.sourceId,
    fuelDate: daysAgo(45),
    makeMileages: 11920,
    unitPrice: 7.85,
    volume: 42,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    remark: ''
  });
  saveRefuel(storage, {
    carSourceId: crv.sourceId,
    fuelDate: daysAgo(30),
    makeMileages: 12280,
    unitPrice: 7.85,
    volume: 38,
    actualPayAmount: null,
    isFull: false,
    isLowFuel: true,
    remark: '跑到亮灯才加'
  });
  saveRefuel(storage, {
    carSourceId: crv.sourceId,
    fuelDate: daysAgo(10),
    makeMileages: 12600,
    unitPrice: 7.85,
    volume: 40,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    remark: ''
  });

  // P7：两次连续充满，产出电耗区间
  saveRefuel(storage, {
    carSourceId: p7.sourceId,
    fuelDate: daysAgo(50),
    makeMileages: 15200,
    unitPrice: 1.2,
    volume: 45,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'ev',
    chargeBeforePercent: 25,
    chargeAfterPercent: 100,
    remark: '家充桩'
  });
  saveRefuel(storage, {
    carSourceId: p7.sourceId,
    fuelDate: daysAgo(20),
    makeMileages: 15550,
    unitPrice: 1.2,
    volume: 48,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'ev',
    chargeBeforePercent: 20,
    chargeAfterPercent: 100,
    remark: ''
  });

  // 唐：混动车，加油 + 充电并存（走 energyType 显式指定）
  saveRefuel(storage, {
    carSourceId: tang.sourceId,
    fuelDate: daysAgo(40),
    makeMileages: 9500,
    unitPrice: 7.8,
    volume: 30,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'fuel',
    remark: ''
  });
  saveRefuel(storage, {
    carSourceId: tang.sourceId,
    fuelDate: daysAgo(25),
    makeMileages: 9800,
    unitPrice: 7.8,
    volume: 28,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'fuel',
    remark: ''
  });
  saveRefuel(storage, {
    carSourceId: tang.sourceId,
    fuelDate: daysAgo(15),
    makeMileages: 9800,
    unitPrice: 1.1,
    volume: 15,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'ev',
    chargeBeforePercent: 40,
    chargeAfterPercent: 100,
    remark: ''
  });

  // ---------- 保养执行（先建项，再记录执行，形成剩余量） ----------
  // 机油：12600 - 7300 = 5300 用量 → 剩余 -300（超期）；空气滤芯：剩 450（临近）
  const oilItem = addMaintain(storage, crv.sourceId, {
    name: '机油机滤',
    cycleMileages: 5000,
    timeUnit: '',
    timeValue: 0
  });
  const airItem = addMaintain(storage, crv.sourceId, {
    name: '空气滤芯',
    cycleMileages: 10000,
    timeUnit: '',
    timeValue: 0
  });
  saveMaintainHandle(storage, {
    carSourceId: crv.sourceId,
    maintainSourceIds: [oilItem.sourceId],
    makeDate: daysAgo(120),
    makeMileages: 7300,
    amount: 480,
    remark: ''
  });
  saveMaintainHandle(storage, {
    carSourceId: crv.sourceId,
    maintainSourceIds: [airItem.sourceId],
    makeDate: daysAgo(330),
    makeMileages: 3050,
    amount: 680,
    remark: ''
  });

  // ---------- 日常支出：4 个预设类别 × 3 个月段 ----------
  const parking = catByName('停车');
  const toll = catByName('高速');
  const insurance = catByName('保险');
  const wash = catByName('洗车');

  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 15, costDate: atMonth(0, 3), remark: '商场地下车库' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 68, costDate: atMonth(0, 9), remark: '去机场' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: wash, amount: 45, costDate: atMonth(0, 14), remark: '' });
  saveCost(storage, { carSourceId: p7.sourceId, categorySourceId: parking, amount: 12, costDate: atMonth(0, 6), remark: '公司楼下车库' });

  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 22, costDate: atMonth(-1, 5), remark: '' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 80, costDate: atMonth(-1, 12), remark: '回老家' });
  saveCost(storage, { carSourceId: p7.sourceId, categorySourceId: wash, amount: 30, costDate: atMonth(-1, 18), remark: '' });
  saveCost(storage, { carSourceId: tang.sourceId, categorySourceId: parking, amount: 10, costDate: atMonth(-1, 25), remark: '' });

  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: insurance, amount: 4800, costDate: atMonth(-5, 20), remark: '交强险 + 商业险' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 12, costDate: atMonth(-3, 8), remark: '' });
}
