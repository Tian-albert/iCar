// SKILL 原子接口的运行时契约测试
//
// 为什么需要它：源码断言只能证明「写了 buildStats」，证明不了「读对了表名、字段对得上」。
// 独立分包里的 store 是手写的，表名（fuelRecords / maintainHandles / maintainLogs）
// 或字段名一旦写错，运行时只会静默返回空数组——AI 会一本正经地回答「没有数据」，
// 而不是报错，这是最难发现的一类问题。
//
// 做法：用内存 Map 打桩 wx.getStorageSync / setStorageSync，按主包真实落盘格式
// （icar:index 索引 + icar:{table}:{id} 明细）铺一份数据，然后直接调用三个接口。
const fsApi = require('fs') as any;

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

  // 加油/充电要靠系统预设类别归类（presetType=refuel / ev）
  put('categories', {
    sourceId: 'mp:category:refuel',
    sourcePlatform: 'mp',
    name: '加油',
    icon: '⛽',
    isPreset: true,
    presetType: 'refuel',
    visible: true,
    sortOrder: 2,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: false
  });

  // 保养类支出靠 presetType='maintain' 归类（addMaintain 用），缺了这笔钱会静默丢失
  put('categories', {
    sourceId: 'mp:category:maintain',
    sourcePlatform: 'mp',
    name: '保养',
    icon: '🔧',
    isPreset: true,
    presetType: 'maintain',
    visible: true,
    sortOrder: 3,
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
    queryCars: require('../skills/icar/apis/queryCars').queryCars,
    queryStats: require('../skills/icar/apis/queryStats').queryStats,
    queryMaintain: require('../skills/icar/apis/queryMaintain').queryMaintain,
    addCost: require('../skills/icar/apis/addCost').addCost,
    addRefuel: require('../skills/icar/apis/addRefuel').addRefuel,
    addMaintain: require('../skills/icar/apis/addMaintain').addMaintain,
    addCar: require('../skills/icar/apis/addCar').addCar,
    updateCar: require('../skills/icar/apis/updateCar').updateCar,
    queryRecords: require('../skills/icar/apis/queryRecords').queryRecords
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
    // 路径不带前导斜杠，与 app.json 的 pages 写法完全一致——
    // 平台按 app.json 匹配页面，多一个斜杠可能匹配不上（蓝链点不开的一个可能原因）
    expect(res.structuredContent.pagePath).toContain('pages/statistics/index?id=');
    expect(res.structuredContent.pagePath.startsWith('/')).toBe(false);
    expect(res.structuredContent.linkText).toBeTruthy();
  });

  it('所有 pagePath 都不带前导斜杠，且能在 app.json 里找到对应页面', async () => {
    const appJson = JSON.parse(fsApi.readFileSync('app.json', 'utf-8'));
    const pages: string[] = appJson.pages;
    const apiDir = 'skills-src/icar/apis';
    for (const name of fsApi.readdirSync(apiDir)) {
      if (!name.endsWith('.ts')) continue;
      const src: string = fsApi.readFileSync(`${apiDir}/${name}`, 'utf-8');
      const re = /pagePath:\s*[`'"]([^`'"]+)[`'"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const path = m[1].split('?')[0];
        expect(path.startsWith('/')).toBe(false);
        expect(pages).toContain(path);
      }
    }
  });

  it('pagePath 不得指向 tabBar 页面（navigateTo 跳不过去，会静默失败）', async () => {
    const appJson = JSON.parse(fsApi.readFileSync('app.json', 'utf-8'));
    const tabPages: string[] = (appJson.tabBar?.list || []).map((t: any) => t.pagePath);
    expect(tabPages.length).toBeGreaterThan(0);

    const apiDir = 'skills-src/icar/apis';
    for (const name of fsApi.readdirSync(apiDir)) {
      if (!name.endsWith('.ts')) continue;
      const src: string = fsApi.readFileSync(`${apiDir}/${name}`, 'utf-8');
      const re = /pagePath:\s*[`'"]([^`'"]+)[`'"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const path = m[1].split('?')[0];
        expect(tabPages).not.toContain(path);
      }
    }
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

  it('里程为 0 时不说「每公里 ¥0.000」，而是说明算不出', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    expect(res.content[0].text).toContain('算不出每公里成本');
    expect(res.content[0].text).not.toContain('每公里 ¥0.000');
  });

  it('没有车辆时给出可执行的引导，而不是抛错', async () => {
    resetMemory();
    const { queryStats } = loadApis();
    const res = await queryStats({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('添加车辆');
  });

  it('车名对不上时报错并列出可选车辆（绝不静默换车）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ carName: '不存在的车' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('我的 CRV');
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

  it('金额超出合理范围时拒绝（100 万停车费）', async () => {
    const { addCost } = loadApis();
    const res = await addCost({ amount: 1000000, categoryName: '停车' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('超出合理范围');
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

/** 追加第二辆车（多车场景用） */
function addSecondCar(): void {
  put('cars', {
    sourceId: 'mp:cars:2',
    sourcePlatform: 'mp',
    name: '老婆的车',
    type: 'car',
    icon: '🚙',
    customIconAssetId: '',
    initDate: new Date(2026, 0, 1).getTime(),
    initMileages: 0,
    mileages: 3000,
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
}

describe('多车场景：读汇总、写追问', () => {
  it('没说车名时 queryStats 返回全部车辆合计与明细', async () => {
    addSecondCar();
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });

    expect(res.isError).toBe(false);
    expect(res.structuredContent.scope).toBe('all');
    expect(res.structuredContent.carCount).toBe('2');
    expect(res.structuredContent.totalExpense).toBe('500.00');
    expect(res.content[0].text).toContain('2 辆车');
    expect(res.content[0].text).toContain('我的 CRV');
    expect(res.content[0].text).toContain('老婆的车');
  });

  it('说了车名则只统计那一辆', async () => {
    addSecondCar();
    const { queryStats } = loadApis();
    const res = await queryStats({ carName: '老婆的车', rangeType: 'all' });
    expect(res.structuredContent.scope).toBe('car');
    expect(res.structuredContent.carName).toBe('老婆的车');
    expect(res.structuredContent.totalExpense).toBe('0.00');
  });

  it('没说车名时 queryMaintain 汇总所有车的待保养项', async () => {
    addSecondCar();
    const { queryMaintain } = loadApis();
    const res = await queryMaintain({});
    expect(res.isError).toBe(false);
    expect(res.structuredContent.scope).toBe('all');
    expect(res.structuredContent.carCount).toBe('2');
  });

  it('多车且没说车名时 addCost 追问，不写库', async () => {
    addSecondCar();
    const before = ((memory.get('icar:index') as any).costs || []).length;
    const { addCost } = loadApis();
    const res = await addCost({ amount: 15, categoryName: '停车' });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('还没说记到哪一辆');
    expect(res.content[0].text).toContain('老婆的车');
    expect(((memory.get('icar:index') as any).costs || []).length).toBe(before);
  });

  it('多车且没说车名时 addRefuel 追问，不写库', async () => {
    addSecondCar();
    const before = ((memory.get('icar:index') as any).fuelRecords || []).length;
    const { addRefuel } = loadApis();
    const res = await addRefuel({ volume: 40, amount: 320 });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('还没说给哪一辆加');
    expect(((memory.get('icar:index') as any).fuelRecords || []).length).toBe(before);
  });

  it('追问后带上车名可以正常写入对应的车', async () => {
    addSecondCar();
    const { addCost } = loadApis();
    const res = await addCost({ amount: 15, categoryName: '停车', carName: '老婆的车' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.carName).toBe('老婆的车');

    const index: any = memory.get('icar:index');
    const saved: any = memory.get(`icar:costs:${index.costs[index.costs.length - 1]}`);
    expect(saved.carSourceId).toBe('mp:cars:2');
  });
});

describe('页面接力（handoff）——评测「页面有效性」依赖它', () => {
  it('mcp.json 每个接口都声明了 _meta.ui.pagePath', () => {
    const mcp = JSON.parse(fsApi.readFileSync('skills/icar/mcp.json', 'utf-8'));
    for (const api of mcp.apis) {
      expect(api._meta).toBeTruthy();
      expect(api._meta.ui.pagePath).toBeTruthy();
      expect(String(api._meta.ui.pagePath).startsWith('/')).toBe(false);
    }
  });

  it('读类接口的接力页必须是聚合视图，不能是某一辆车的详情', () => {
    const mcp = JSON.parse(fsApi.readFileSync('skills/icar/mcp.json', 'utf-8'));
    const pathOf = (name: string) => mcp.apis.find((a: any) => a.name === name)._meta.ui.pagePath;
    // 「我有几辆车」→ 我的车辆列表；「今年花了多少」→ 概览
    expect(pathOf('queryCars')).toBe('pages/summary/index');
    expect(pathOf('queryStats')).toBe('pages/summary/index');
    // 全车保养页：按车分组列临期/超期，比概览锚点更精准
    expect(pathOf('queryMaintain')).toBe('pages/maintain-all/index');
    // 单车写操作落到这辆车的详情是合理的
    expect(pathOf('addCost')).toBe('pages/vehicle-detail/index');
    expect(pathOf('addRefuel')).toBe('pages/vehicle-detail/index');
  });

  it('每个接口的返回值都带 handoff，且 payload 有效', async () => {
    const { queryCars, queryStats, queryMaintain, addCost, addRefuel } = loadApis();

    const results = [
      await queryCars({}),
      await queryStats({ rangeType: 'all' }),
      await queryMaintain({}),
      await addCost({ amount: 15, categoryName: '停车' }),
      await addRefuel({ volume: 40, amount: 320, mileage: 7000 })
    ];

    for (const res of results) {
      expect(res.isError).toBe(false);
      expect(typeof res.handoff).toBe('function');
      const { query, payload } = res.handoff({ result: res } as any);
      // 列表页/概览页是 tabBar 页，不带业务 query；单车页才带 id
      expect(typeof query).toBe('string');
      expect(payload).toBeTruthy();
    }
  });

  it('全车类查询接力到列表页/概览页，而不是某一辆车的详情页', async () => {
    addSecondCar(); // 多车才会触发全车作用域
    const { queryCars, queryStats, queryMaintain } = loadApis();

    const cars = await queryCars({});
    expect(cars.handoff({ result: cars } as any).query).toBe('rangeType=all');

    const stats = await queryStats({ rangeType: 'all' });
    expect(stats.handoff({ result: stats } as any).query).toBe('rangeType=all');

    // 保养汇总仍落概览（保养提醒区块在那里），不带业务 query
    const maintain = await queryMaintain({});
    expect(maintain.handoff({ result: maintain } as any).query).toBe('');
  });

  it('单车查询的 handoff 带编码后的车 id（含冒号，不编码会解析错）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ carName: '我的 CRV', rangeType: 'all' });
    const { query } = res.handoff({ result: res } as any);
    expect(query).toContain('mp%3Acars%3A');
  });
});

describe('分类明细（「洗车/高速花了多少」要能答）', () => {
  it('统计结果带 categories，且文案里出现分类金额', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    expect(Array.isArray(res.structuredContent.categories)).toBe(true);
    expect(res.structuredContent.categories.length).toBeGreaterThan(0);
    expect(res.content[0].text).toContain('分类上');
    expect(res.content[0].text).toContain('停车');
  });
});

describe('车名匹配不上时的回落策略', () => {
  it('多辆车 + 车名匹配不上 → 回落全车汇总并说明，不报错', async () => {
    addSecondCar();
    const { queryStats, queryMaintain } = loadApis();

    const stats = await queryStats({ carName: '两辆车', rangeType: 'all' });
    expect(stats.isError).toBe(false);
    expect(stats.structuredContent.scope).toBe('all');
    expect(stats.content[0].text).toContain('没有找到叫「两辆车」的车');

    const maintain = await queryMaintain({ carName: '两辆车' });
    expect(maintain.isError).toBe(false);
    expect(maintain.structuredContent.scope).toBe('all');
  });

  it('只有一辆车 + 车名匹配不上 → 仍然报错（不能假装是那辆车）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ carName: '老婆的车' });
    expect(res.isError).toBe(true);
  });
});

describe('queryCars', () => {
  it('列出车辆并标出置顶', async () => {
    const { queryCars } = loadApis();
    const res = await queryCars({});
    expect(res.isError).toBe(false);
    expect(res.structuredContent.count).toBe('1');
    expect(res.content[0].text).toContain('我的 CRV（燃油，5850 km，置顶）');
  });

  it('没有车辆时给引导而不是空回答', async () => {
    resetMemory();
    const { queryCars } = loadApis();
    const res = await queryCars({});
    expect(res.isError).toBe(false);
    expect(res.structuredContent.count).toBe('0');
    expect(res.content[0].text).toContain('还没有添加任何车辆');
  });
});

describe('addRefuel', () => {
  it('只给量 + 金额时反算单价，并同步写入关联支出', async () => {
    const { addRefuel, queryStats } = loadApis();
    const res = await addRefuel({ volume: 40, amount: 320, mileage: 6250 });

    expect(res.isError).toBe(false);
    expect(res.structuredContent.unitPrice).toBe('8.00');
    expect(res.structuredContent.amount).toBe('320.00');
    expect(res.content[0].text).toContain('加油 40 升');

    // 加油必须同时产生一笔支出，否则「今年花了多少」会漏账
    const stats = await queryStats({ rangeType: 'all' });
    expect(stats.structuredContent.totalExpense).toBe('820.00');
    expect(stats.structuredContent.energyCost).toBe('320.00');
  });

  it('两次加满后自动算出油耗区间', async () => {
    const { addRefuel } = loadApis();
    await addRefuel({ volume: 40, amount: 320, mileage: 6050 });
    const second = await addRefuel({ volume: 40, amount: 320, mileage: 6450 });

    // 区间 400km、40L → 10.00 L/100km
    expect(second.structuredContent.consumption).toBe('10.00');
    expect(second.structuredContent.consumptionMileage).toBe('400');
    expect(second.content[0].text).toContain('本次算出油耗 10.00 L/100km');
  });

  it('没加满时不产出区间，并解释原因', async () => {
    const { addRefuel } = loadApis();
    await addRefuel({ volume: 40, amount: 320, mileage: 6050 });
    const res = await addRefuel({ volume: 20, amount: 160, mileage: 6200, isFull: false });

    expect(res.structuredContent.consumption).toBe('');
    expect(res.content[0].text).toContain('没加满');
  });

  it('缺少加油量或金额时先追问，且不写库', async () => {
    const { addRefuel } = loadApis();
    const before = ((memory.get('icar:index') as any).fuelRecords || []).length;

    const noVolume = await addRefuel({ amount: 320 });
    expect(noVolume.isError).toBe(true);
    expect(noVolume.content[0].text).toContain('缺少加油量');

    const noMoney = await addRefuel({ volume: 40 });
    expect(noMoney.isError).toBe(true);
    expect(noMoney.content[0].text).toContain('缺少金额');

    const after = ((memory.get('icar:index') as any).fuelRecords || []).length;
    expect(after).toBe(before);
  });

  it('没给里程时沿用车辆当前里程，并在文案里说明', async () => {
    const { addRefuel } = loadApis();
    const res = await addRefuel({ volume: 40, amount: 320 });
    expect(res.structuredContent.mileage).toBe('5850');
    expect(res.content[0].text).toContain('沿用了车辆当前里程');
  });

  it('加满后回写车辆里程（否则保养剩余量会算错）', async () => {
    const { addRefuel, queryMaintain } = loadApis();
    await addRefuel({ volume: 40, amount: 320, mileage: 7000 });
    const car: any = memory.get(`icar:cars:${CAR_ID}`);
    expect(car.mileages).toBe(7000);

    // 里程涨了，机油（周期 5000）剩余量应随之减少
    const maintain = await queryMaintain({});
    expect(maintain.content[0].text).toContain('超期 2000 km');
  });

  it('数量超出合理范围时拒绝（500 升）', async () => {
    const { addRefuel } = loadApis();
    const res = await addRefuel({ volume: 500, amount: 4000 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('超出合理范围');
  });

  it('可以显式指定 energyType（混动车加油/充电都要记）', async () => {
    const { addRefuel } = loadApis();
    // 车是燃油车，但用户说「充电」→ 显式指定后按充电记
    const res = await addRefuel({ volume: 40, amount: 60, energyType: 'ev' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.kindLabel).toBe('充电');
    expect(res.structuredContent.volumeUnit).toBe('kWh');
  });

  it('纯电车按充电记录，产出电耗而不是油耗', async () => {
    resetMemory();
    seed();
    const car: any = memory.get(`icar:cars:${CAR_ID}`);
    car.energyType = 'ev';
    memory.set(`icar:cars:${CAR_ID}`, car);

    const { addRefuel } = loadApis();
    const res = await addRefuel({ volume: 60, amount: 90, mileage: 5850 });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.kindLabel).toBe('充电');
    expect(res.structuredContent.volumeUnit).toBe('kWh');
    expect(res.structuredContent.consumptionUnit).toBe('kWh/100km');
  });
});

describe('queryStats 自定义区间（最近半个月 / 国庆）', () => {
  it('按 startDate/endDate 统计，并把区间带进接力与蓝链', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'custom', startDate: '2026-11-01', endDate: '2026-11-20' });

    expect(res.isError).toBe(false);
    expect(res.structuredContent.rangeLabel).toBe('2026-11-01 至 2026-11-20');

    // 单车时落单车统计页（range=custom）；多车落数据总览（rangeType=custom），见下一条
    const { query } = res.handoff({ result: res } as any);
    expect(query).toContain('custom');
    expect(query).toContain('start=2026-11-01');
    expect(query).toContain('end=2026-11-20');
  });

  it('日期缺失或格式不对时退回本年，不报错卡死对话', async () => {
    const { queryStats } = loadApis();
    const bad = await queryStats({ rangeType: 'custom', startDate: '上个月' });
    expect(bad.isError).toBe(false);
    expect(bad.structuredContent.rangeLabel).toContain('年');
  });

  it('起止颠倒时按先后的正确区间算（不产生负区间）', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'custom', startDate: '2026-11-20', endDate: '2026-11-01' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.rangeLabel).toBe('2026-11-20 至 2026-11-20');
  });
});

describe('queryStats 自定义区间落到数据总览', () => {
  it('多车时不传车名 → 接力落数据总览并带 rangeType=custom', async () => {
    addSecondCar();
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'custom', startDate: '2026-10-01', endDate: '2026-10-07' });
    expect(res.structuredContent.scope).toBe('all');
    const { query } = res.handoff({ result: res } as any);
    expect(query).toContain('rangeType=custom');
    expect(query).toContain('start=2026-10-01');
    expect(query).toContain('end=2026-10-07');
  });
});

describe('分类明细带笔数（「今年加油花了多少」要能答出次数）', () => {
  it('回复文案里出现「N 次 ¥金额」', async () => {
    const { queryStats } = loadApis();
    const res = await queryStats({ rangeType: 'all' });
    expect(res.content[0].text).toContain('次 ¥');
    expect(Array.isArray(res.structuredContent.categories)).toBe(true);
    expect(res.structuredContent.categories[0].count).toBeTruthy();
  });
});

describe('追问轮也要有页面接力（评测对每轮接口调用都检查 handoff）', () => {
  it('多车没说车名时 addCost 追问，同时给出 handoff', async () => {
    addSecondCar();
    const { addCost } = loadApis();
    const res = await addCost({ amount: 15, categoryName: '停车' });

    expect(res.isError).toBe(true);
    expect(typeof res.handoff).toBe('function');
    const { query } = res.handoff({ result: res } as any);
    expect(query).toBe('rangeType=all');
  });

  it('多车没说车名时 addRefuel 追问，同时给出 handoff', async () => {
    addSecondCar();
    const { addRefuel } = loadApis();
    const res = await addRefuel({ volume: 40, amount: 320 });
    expect(res.isError).toBe(true);
    expect(typeof res.handoff).toBe('function');
  });

  it('空库时也给出 handoff（否则同样被判未触发接力）', async () => {
    resetMemory();
    const { addCost } = loadApis();
    const res = await addCost({ amount: 15 });
    expect(res.isError).toBe(true);
    expect(typeof res.handoff).toBe('function');
  });
});

describe('addMaintain', () => {
  it('记一次保养：写入执行记录 + 关联流水 + 支出，并重置周期', async () => {
    const { addMaintain, queryMaintain, queryStats } = loadApis();
    const res = await addMaintain({ maintainName: '机油机滤', mileage: 8000, amount: 480 });

    expect(res.isError).toBe(false);
    expect(res.structuredContent.maintainName).toBe('机油机滤');
    expect(res.structuredContent.amount).toBe('480.00');
    // 周期 5000：8000 - 8000 = 0 → 剩 5000
    expect(res.structuredContent.remainText).toContain('5000');

    // 保养后不再超期
    const mnt = await queryMaintain({});
    expect(mnt.content[0].text).not.toContain('超期');

    // 金额进支出
    const stats = await queryStats({ rangeType: 'all' });
    expect(stats.structuredContent.totalExpense).toBe('980.00');
  });

  it('保养项不存在时报错并列出可选，绝不凭空造项', async () => {
    const { addMaintain } = loadApis();
    const res = await addMaintain({ maintainName: '轮胎', mileage: 8000 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('机油机滤');
    expect(res.content[0].text).toContain('空气滤芯');
  });

  it('没说保养项时先问，并给出 handoff', async () => {
    const { addMaintain } = loadApis();
    const res = await addMaintain({ amount: 300 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('哪一项');
    expect(typeof res.handoff).toBe('function');
  });

  it('多车没说车名时追问，不写库', async () => {
    addSecondCar();
    const before = ((memory.get('icar:index') as any).maintainHandles || []).length;
    const { addMaintain } = loadApis();
    const res = await addMaintain({ maintainName: '机油机滤', amount: 480 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('哪一辆');
    expect(((memory.get('icar:index') as any).maintainHandles || []).length).toBe(before);
  });

  it('里程涨了就回写车辆里程（否则保养剩余量会偏小）', async () => {
    const { addMaintain } = loadApis();
    await addMaintain({ maintainName: '机油机滤', mileage: 9000 });
    const car: any = memory.get(`icar:cars:${CAR_ID}`);
    expect(car.mileages).toBe(9000);
  });
});

describe('addCar / updateCar', () => {
  it('新增车辆：写入并回写车数', async () => {
    const { addCar, queryCars } = loadApis();
    const res = await addCar({ name: '老王的 CRV', energyType: 'fuel', mileages: 12000 });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.carName).toBe('老王的 CRV');
    expect(res.structuredContent.carCount).toBe('2');

    const cars = await queryCars({});
    expect(cars.content[0].text).toContain('老王的 CRV');
  });

  it('新增纯电车：能量类型与图标按类型给', async () => {
    const { addCar } = loadApis();
    const res = await addCar({ name: '小鹏 P7', energyType: 'ev', batteryCapacity: 80 });
    expect(res.structuredContent.energyType).toBe('纯电');
    const cars: any[] = ((memory.get('icar:index') as any).cars || []).map((id: string) => memory.get(`icar:cars:${id}`));
    const ev = cars.find(c => c.name === '小鹏 P7');
    expect(ev.energyType).toBe('ev');
    expect(ev.batteryCapacity).toBe(80);
  });

  it('重名时拒绝，不写库', async () => {
    const { addCar } = loadApis();
    const before = ((memory.get('icar:index') as any).cars || []).length;
    const res = await addCar({ name: '我的 CRV' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('已经有一辆叫');
    expect(((memory.get('icar:index') as any).cars || []).length).toBe(before);
  });

  it('改名：校验重名后落库', async () => {
    const { updateCar, queryCars } = loadApis();
    const res = await updateCar({ carName: '我的 CRV', newName: '老王的 CRV' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.changed).toContain('名称');

    const cars = await queryCars({});
    expect(cars.content[0].text).toContain('老王的 CRV');
    expect(cars.content[0].text).not.toContain('我的 CRV');
  });

  it('改里程：同步到车辆档案', async () => {
    const { updateCar } = loadApis();
    const res = await updateCar({ carName: '我的 CRV', mileages: 20000 });
    expect(res.isError).toBe(false);
    const car: any = memory.get(`icar:cars:${CAR_ID}`);
    expect(car.mileages).toBe(20000);
  });

  it('什么都没改时拒绝，不空调用', async () => {
    const { updateCar } = loadApis();
    const res = await updateCar({ carName: '我的 CRV' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('没有变化');
  });

  it('多车没说改哪辆时追问', async () => {
    addSecondCar();
    const { updateCar } = loadApis();
    const res = await updateCar({ mileages: 9999 });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('哪一辆');
  });
});

describe('queryRecords', () => {
  it('返回近期记录与合计（加油从 refuel 反查升数）', async () => {
    const { queryRecords, addRefuel } = loadApis();
    await addRefuel({ volume: 40, amount: 320, mileage: 6250 });

    const res = await queryRecords({ carName: '我的 CRV' });
    expect(res.isError).toBe(false);
    expect(res.structuredContent.count).toBeTruthy();
    // 加油那条应带「40 升」
    expect(res.structuredContent.items).toContain('40 升');
    // 合计 = 种子里的 500 + 加油 320
    expect(res.structuredContent.totalExpense).toBe('820.00');
  });

  it('按类型过滤：只看加油', async () => {
    const { queryRecords, addRefuel } = loadApis();
    await addRefuel({ volume: 40, amount: 320, mileage: 6250 });
    const res = await queryRecords({ type: 'fuel' });
    expect(res.isError).toBe(false);
    const items: string = res.structuredContent.items;
    expect(items).toContain('加油');
    expect(items).not.toContain('停车');
  });

  it('没有记录时说清楚，而不是空回答', async () => {
    const { queryRecords } = loadApis();
    const res = await queryRecords({ rangeType: 'month', year: 2020, month: 1 });
    expect(res.isError).toBe(false);
    expect(res.content[0].text).toContain('没有记录');
  });

  it('多车没说车名时追问并给 handoff', async () => {
    addSecondCar();
    const { queryRecords } = loadApis();
    const res = await queryRecords({});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('哪一辆');
    expect(typeof res.handoff).toBe('function');
  });
});
