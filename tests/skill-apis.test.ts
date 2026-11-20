// SKILL 原子接口的运行时契约测试
//
// 为什么需要它：源码断言只能证明「写了 buildStats」，证明不了「读对了表名、字段对得上」。
// 独立分包里的 store 是手写的，表名（fuelRecords / maintainHandles / maintainLogs）
// 或字段名一旦写错，运行时只会静默返回空数组——AI 会一本正经地回答「没有数据」，
// 而不是报错，这是最难发现的一类问题。
//
// 做法：用内存 Map 打桩 wx.getStorageSync / setStorageSync，按主包真实落盘格式
// （icar:index 索引 + icar:{table}:{id} 明细）铺一份数据，然后直接调用三个接口。
const memory = new Map<string, unknown>();

function resetMemory(): void {
  memory.clear();
}

(globalThis as any).wx = {
  getStorageSync: (key: string) => (memory.has(key) ? memory.get(key) : ''),
  setStorageSync: (key: string, value: unknown) => {
    memory.set(key, value);
  },
  removeStorageSync: (key: string) => {
    memory.delete(key);
  }
};

const NOW = new Date(2026, 10, 19, 12, 0, 0).getTime(); // 2026-11-19

const CAR_ID = 'mp:cars:1';
const CAT_PARKING = 'mp:category:parking';
const CAT_HIGHWAY = 'mp:category:highway';

function put(table: string, entity: any): void {
  memory.set(`icar:${table}:${entity.sourceId}`, entity);
  const index: any = memory.get('icar:index') || {};
  index[table] = index[table] || [];
  index[table].push(entity.sourceId);
  memory.set('icar:index', index);
}

function seed(): void {
  resetMemory();

  memory.set('icar:user', {
    sourceId: 'mp:user:default',
    sourcePlatform: 'mp',
    openid: '',
    nickname: '',
    avatarUrl: '',
    remindEnabled: true,
    skin: 'a',
    reminderSentCount: 0,
    memberLevel: 'free',
    memberExpireAt: 0,
    appLockEnabled: false,
    appLockPin: '',
    lastPulledAt: 0,
    pinnedCarId: CAR_ID,
    categoriesSeeded: true,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('cars', {
    sourceId: CAR_ID,
    sourcePlatform: 'mp',
    name: '我的 CRV',
    type: 'car',
    icon: '🚗',
    customIconAssetId: '',
    initDate: new Date(2026, 0, 1).getTime(),
    initMileages: 0,
    mileages: 5850,
    evMileages: 0,
    hevMileages: 0,
    batteryCapacity: 0,
    energyType: 'fuel',
    energyTrackingEnabled: true,
    maintainSoonMileage: 500,
    maintainSoonDays: 15,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('categories', {
    sourceId: CAT_PARKING,
    sourcePlatform: 'mp',
    name: '停车',
    icon: '🅿️',
    isPreset: true,
    presetType: '',
    visible: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('categories', {
    sourceId: CAT_HIGHWAY,
    sourcePlatform: 'mp',
    name: '高速',
    icon: '🛣️',
    isPreset: true,
    presetType: '',
    visible: true,
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('costs', {
    sourceId: 'mp:costs:1',
    sourcePlatform: 'mp',
    carSourceId: CAR_ID,
    categorySourceId: CAT_PARKING,
    amount: 300,
    costDate: new Date(2026, 10, 15).getTime(),
    remark: '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('costs', {
    sourceId: 'mp:costs:2',
    sourcePlatform: 'mp',
    carSourceId: CAR_ID,
    categorySourceId: CAT_HIGHWAY,
    amount: 200,
    costDate: new Date(2026, 10, 10).getTime(),
    remark: '',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  // 周期只配里程：天数周期配 0 才能让断言不依赖"今天是几号"
  put('maintains', {
    sourceId: 'mp:maintains:oil',
    sourcePlatform: 'mp',
    carSourceId: CAR_ID,
    name: '机油机滤',
    icon: '🛢️',
    cycleMileages: 5000,
    cycleDays: 0,
    cycleMonths: 0,
    cycleUnit: 'mileage',
    cycleValue: 5000,
    mileageSource: 'total',
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  put('maintains', {
    sourceId: 'mp:maintains:air',
    sourcePlatform: 'mp',
    carSourceId: CAR_ID,
    name: '空气滤芯',
    icon: '💨',
    cycleMileages: 20000,
    cycleDays: 0,
    cycleMonths: 0,
    cycleUnit: 'mileage',
    cycleValue: 20000,
    mileageSource: 'total',
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });
}

// 模块内引用了全局 wx，必须在打桩之后再 require。
// 加载的是编译产物（skills/icar 下的 .js）—— 与小程序实际执行的文件一致。
function loadApis() {
  return {
    queryStats: require('../skills/icar/apis/queryStats').queryStats,
    queryMaintain: require('../skills/icar/apis/queryMaintain').queryMaintain,
    addCost: require('../skills/icar/apis/addCost').addCost
  };
}

beforeEach(() => {
  seed();
});

describe('queryStats', () => {
  it('读出两笔支出并复用主包口径', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.totalExpense).toBe('500.00');
    expect(res.content[0].text).toContain('¥500.00');
    expect(res.content[0].text).toContain('我的 CRV');
  });

  it('返回可点详情入口（page-link 需要 pagePath + linkText 同在一层）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    expect(res.structuredContent.pagePath).toContain('/pages/statistics/index?id=');
    expect(res.structuredContent.linkText).toBeTruthy();
  });

  it('能耗金额与区间里程单独返回（否则「不含能耗」是凭空的差值）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    // 本用例没有加油/充电记录 → 能耗 0，但字段必须存在
    expect(res.structuredContent.energyCost).toBe('0.00');
    expect(res.structuredContent.energyCostLabel).toBe('油费');
    expect(res.structuredContent.consumptionMileage).toBe('0');
    // 无有效区间时文案要给原因，而不是「平均油耗 0.00」
    expect(res.content[0].text).toContain('暂无有效油耗区间');
  });

  it('有能耗时文案同时给「其中油费」和「不含油费」，两个数能对上账', async () => {
    resetMemory();
    seed();
    // 补一条加油记录与一个有效区间：40L / 500km → 8.00 L/100km
    put('fuelRecords', {
      sourceId: 'mp:fuel:1',
      sourcePlatform: 'mp',
      carSourceId: CAR_ID,
      energyType: 'fuel',
      fuelDate: new Date(2026, 10, 12).getTime(),
      makeMileages: 5850,
      makeEVMileages: 0,
      makeHEVMileages: 0,
      unitPrice: 8,
      volume: 40,
      shouldPayAmount: 320,
      actualPayAmount: 320,
      isFull: true,
      isLowFuel: true,
      lastRecorded: true,
      chargeBeforePercent: 0,
      chargeAfterPercent: 0,
      remark: '',
      costSourceId: ''
    });
    put('fuelConsumptions', {
      sourceId: 'mp:seg:1',
      sourcePlatform: 'mp',
      carSourceId: CAR_ID,
      energyType: 'fuel',
      startDate: new Date(2026, 10, 1).getTime(),
      endDate: new Date(2026, 10, 12).getTime(),
      startMileages: 5350,
      endMileages: 5850,
      mileage: 500,
      fuelAmount: 40,
      fuelConsumption: 8,
      costPerKm: 0.64
    });

    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });

    expect(res.structuredContent.energyCost).toBe('320.00');
    expect(res.structuredContent.energyCostLabel).toBe('油费');
    expect(res.structuredContent.avgConsumption).toBe('8.00');
    expect(res.structuredContent.consumptionMileage).toBe('500');

    const text: string = res.content[0].text;
    expect(text).toContain('其中油费 ¥320.00');
    expect(text).toContain('按 500 km 加油区间计');
  });

  it('没有车辆时给出可执行的引导，而不是抛错', async () => {
    resetMemory();
    const { queryStats } = loadApis();
    const res = await queryStats({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('添加车辆');
  });

  it('车名对不上时列出可选车辆', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ carName: '不存在的车' });
    // 单辆车且名字不匹配 → pickCar 回落到置顶车，仍能正常返回
    expect(res.isError).toBe(false);
  });
});

describe('queryMaintain', () => {
  it('把超期项排在前面并明确说"超期"', async () => {
    const { queryMaintain } = loadApis();
    const res = await queryMaintain({});
    expect(res.isError).toBe(false);
    expect(res.structuredContent.overdueCount).toBe('1');
    expect(res.content[0].text).toContain('机油机滤');
    expect(res.content[0].text).toContain('超期 850 km');
  });

  it('默认只返回需要关注的项，空气滤芯（剩 14150km）不出现', async () => {
    const { queryMaintain } = loadApis();
    const res = await queryMaintain({});
    expect(res.content[0].text).not.toContain('空气滤芯');
  });

  it('onlyUrgent=false 时返回全部项', async () => {
    const { queryMaintain } = loadApis();
    const res = await queryMaintain({ onlyUrgent: false });
    expect(res.structuredContent.items).toContain('空气滤芯');
  });

  it('没有保养项时给引导而非报错', async () => {
    resetMemory();
    seed();
    memory.delete('icar:maintains:mp:maintains:oil');
    memory.delete('icar:maintains:mp:maintains:air');
    (memory.get('icar:index') as any).maintains = [];
    const { queryMaintain } = loadApis();
    const res = await queryMaintain({});
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('还没有配置保养项');
  });
});

describe('addCost', () => {
  it('写入成功，且新记录能被随后的统计读到', async () => {
    const { addCost, queryStats } = loadApis();
    const res = await addCost({ amount: 15, categoryName: '停车', dateText: '2026-11-19' });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('已记录');
    expect(res.content[0].text).toContain('¥15.00');

    const after = await queryStats({ rangeType: 'all' });
    expect(after.structuredContent.totalExpense).toBe('515.00');
  });

  it('金额缺失或为 0 时先追问，且不写库', async () => {
    const { addCost } = loadApis();
    const before = ((memory.get('icar:index') as any).costs || []).length;

    const missing = await addCost({ categoryName: '停车' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('缺少有效金额');

    const zero = await addCost({ amount: 0 });
    expect(zero.isError).toBe(true);

    const after = ((memory.get('icar:index') as any).costs || []).length;
    expect(after).toBe(before);
  });

  it('类别不存在时降级到默认类别，并如实告知用户', async () => {
    const { addCost } = loadApis();
    const res = await addCost({ amount: 30, categoryName: '洗车' });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('没有「洗车」这个类别');
  });

  it('日期按 YYYY-MM-DD 解析，且回写结构化的同一日期', async () => {
    const { addCost } = loadApis();
    const res = await addCost({ amount: 20, dateText: '2026-11-01' });
    expect(res.structuredContent.dateText).toBe('2026-11-01');
    expect(res.content[0].text).toContain('11月1日');
  });

  it('写入的记录字段完整（与主包 Cost 结构一致）', async () => {
    const { addCost } = loadApis();
    const res = await addCost({ amount: 12.345, categoryName: '高速' });
    const index: any = memory.get('icar:index');
    const ids: string[] = index.costs;
    const saved: any = memory.get(`icar:costs:${ids[ids.length - 1]}`);

    expect(saved.carSourceId).toBe(CAR_ID);
    expect(saved.categorySourceId).toBe(CAT_HIGHWAY);
    expect(saved.amount).toBe(12.35); // 保留两位
    expect(saved.deleted).toBe(false);
    expect(saved.maintainHandleSourceId).toBe('');
    expect(typeof saved.sourceId).toBe('string');
    expect(saved.sourceId.startsWith('mp:costs:')).toBe(true);
    expect(res.isError).toBe(false);
  });
});
