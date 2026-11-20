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
 * 保证「这个月 / 上个月 / 去年」的查询永远有数据，无论评测在哪一天跑。
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

/**
 * 通过真实服务链路造数据。
 *
 * 数值不是随手编的，按「真实车主一年」的量级设计，否则评测里会出现
 * 「每公里 6 元」这种一眼假的结论：
 *   · 三辆车合计年里程 ≈ 1.1 万公里，年支出 ≈ 1.2 万元 → 每公里 ≈ 1.1 元；
 *   · 燃油车 10 次加满，跨度 6,500 km → 油耗 ≈ 8 L/100km（正常区间）；
 *   · 纯电车 4 次充满，跨度 1,700 km → 电耗 ≈ 15 kWh/100km；
 *   · 去年（2025）留了 3 笔支出，让「跟去年比」有真实基线，而不是 0。
 */
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
    mileages: 15600,
    initMileages: 0,
    initDate: daysAgo(760),
    energyType: 'fuel',
    icon: '🚗'
  });
  const p7 = createCar(storage, {
    name: '小鹏 P7',
    mileages: 21500,
    initMileages: 5000,
    initDate: daysAgo(730),
    energyType: 'ev',
    batteryCapacity: 80,
    icon: '🚙'
  });
  const tang = createCar(storage, {
    name: '唐 DM-i',
    mileages: 12300,
    initMileages: 0,
    initDate: daysAgo(700),
    energyType: 'hybrid',
    batteryCapacity: 22,
    icon: '🚐'
  });

  // ---------- 加油：燃油车 10 次（跨 6,500 km，8 次加满串成有效区间） ----------
  const crvRefuels: Array<[number, number, boolean, boolean]> = [
    // [几天前, 里程, 是否加满, 是否油量低]
    [300, 9100, true, false],
    [270, 9800, true, false],
    [240, 10500, true, false],
    [210, 11200, true, false],
    [180, 11900, false, true], // 未加满但油量低 → 仍可作区间起点
    [150, 12600, true, false],
    [120, 13300, true, false],
    [90, 14000, true, false],
    [60, 14700, true, false],
    [8, 15600, true, false]
  ];
  crvRefuels.forEach(([days, mileage, isFull, isLowFuel]) => {
    saveRefuel(storage, {
      carSourceId: crv.sourceId,
      fuelDate: daysAgo(days),
      makeMileages: mileage,
      unitPrice: 7.62,
      volume: 55,
      actualPayAmount: null,
      isFull,
      isLowFuel,
      remark: isLowFuel ? '跑到亮灯才加' : ''
    });
  });

  // ---------- 充电：纯电车 4 次充满（跨 1,700 km，电耗 ≈ 15 kWh/100km） ----------
  const p7Charges: Array<[number, number]> = [
    [120, 19800],
    [85, 20400],
    [40, 21000],
    [10, 21500]
  ];
  p7Charges.forEach(([days, mileage]) => {
    saveRefuel(storage, {
      carSourceId: p7.sourceId,
      fuelDate: daysAgo(days),
      makeMileages: mileage,
      unitPrice: 1.15,
      volume: 65,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'ev',
      chargeBeforePercent: 20,
      chargeAfterPercent: 100,
      remark: '家充桩'
    });
  });

  // ---------- 混动车：加油 4 次 + 充电 1 次（同一辆车两种能量并存） ----------
  const tangRefuels: Array<[number, number]> = [
    [150, 9300],
    [110, 10300],
    [70, 11300],
    [30, 12300]
  ];
  tangRefuels.forEach(([days, mileage]) => {
    saveRefuel(storage, {
      carSourceId: tang.sourceId,
      fuelDate: daysAgo(days),
      makeMileages: mileage,
      unitPrice: 7.62,
      volume: 40,
      actualPayAmount: null,
      isFull: true,
      isLowFuel: false,
      energyType: 'fuel',
      remark: ''
    });
  });
  saveRefuel(storage, {
    carSourceId: tang.sourceId,
    fuelDate: daysAgo(20),
    makeMileages: 12300,
    unitPrice: 1.15,
    volume: 15,
    actualPayAmount: null,
    isFull: true,
    isLowFuel: false,
    energyType: 'ev',
    chargeBeforePercent: 30,
    chargeAfterPercent: 100,
    remark: ''
  });

  // ---------- 保养：主车一红一橙，另两辆各一项正常（全车汇总才有内容） ----------
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
  // 机油：15,600 - 10,300 = 5,300 用量 → 剩余 -300（超期）
  saveMaintainHandle(storage, {
    carSourceId: crv.sourceId,
    maintainSourceIds: [oilItem.sourceId],
    makeDate: daysAgo(200),
    makeMileages: 10300,
    amount: 480,
    remark: ''
  });
  // 空气滤芯：15,600 - 6,050 = 9,550 用量 → 剩余 450（临近）
  saveMaintainHandle(storage, {
    carSourceId: crv.sourceId,
    maintainSourceIds: [airItem.sourceId],
    makeDate: daysAgo(420),
    makeMileages: 6050,
    amount: 680,
    remark: ''
  });

  const p7Filter = addMaintain(storage, p7.sourceId, {
    name: '空调滤芯',
    cycleMileages: 20000,
    timeUnit: '',
    timeValue: 0
  });
  // P7：21,500 - 3,400 = 18,100 用量 → 剩余 1,900（正常，不入「待处理」）
  saveMaintainHandle(storage, {
    carSourceId: p7.sourceId,
    maintainSourceIds: [p7Filter.sourceId],
    makeDate: daysAgo(500),
    makeMileages: 3400,
    amount: 260,
    remark: ''
  });

  addMaintain(storage, tang.sourceId, {
    name: '刹车油',
    cycleMileages: 40000,
    timeUnit: '',
    timeValue: 0
  });

  // ---------- 日常支出：4 个预设类别，覆盖本月 / 上月 / 更早 / 去年 ----------
  const parking = catByName('停车');
  const toll = catByName('高速');
  const insurance = catByName('保险');
  const wash = catByName('洗车');

  // 本月
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 15, costDate: atMonth(0, 3), remark: '商场地下车库' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 68, costDate: atMonth(0, 9), remark: '去机场' });
  saveCost(storage, { carSourceId: p7.sourceId, categorySourceId: wash, amount: 45, costDate: atMonth(0, 14), remark: '' });
  saveCost(storage, { carSourceId: p7.sourceId, categorySourceId: parking, amount: 12, costDate: atMonth(0, 6), remark: '公司楼下车库' });

  // 上月
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 22, costDate: atMonth(-1, 5), remark: '' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 80, costDate: atMonth(-1, 12), remark: '回老家' });
  saveCost(storage, { carSourceId: p7.sourceId, categorySourceId: wash, amount: 30, costDate: atMonth(-1, 18), remark: '' });
  saveCost(storage, { carSourceId: tang.sourceId, categorySourceId: parking, amount: 10, costDate: atMonth(-1, 25), remark: '' });

  // 更早（今年内）
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 18, costDate: atMonth(-2, 8), remark: '' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 95, costDate: atMonth(-3, 8), remark: '自驾游' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: insurance, amount: 4800, costDate: atMonth(-5, 20), remark: '交强险 + 商业险' });

  // 去年（2025）：让「跟去年比」有真实基线——之前没有去年数据，AI 把 0 编成了 ¥680
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: insurance, amount: 4500, costDate: atMonth(-12, 18), remark: '去年保费' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: toll, amount: 60, costDate: atMonth(-13, 20), remark: '' });
  saveCost(storage, { carSourceId: crv.sourceId, categorySourceId: parking, amount: 10, costDate: atMonth(-13, 6), remark: '' });
}
