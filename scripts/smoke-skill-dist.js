// 编译产物的冒烟测试：直接 require skills/icar 下的 .js，
// 验证「小程序实际加载的文件」语法正确、能执行、能返回结果。
// 这是为了抓住「TS 源码正确但产物损坏」的情况（真机报 Invalid token 就是这一类）。
const path = require('path');

// ---- wx 打桩 ----
const memory = new Map();
globalThis.wx = {
  getStorageSync: k => (memory.has(k) ? memory.get(k) : ''),
  setStorageSync: (k, v) => memory.set(k, v),
  modelContext: {
    _registered: {},
    createSkill() {
      return {
        use() {},
        registerAPI(name, fn) {
          this._registered = globalThis.wx.modelContext._registered;
          this._registered[name] = fn;
        }
      };
    },
    _registered: {}
  }
};

// 加载入口（会触发 createSkill + registerAPI）
require(path.join(__dirname, '..', 'skills', 'icar', 'index.js'));

const registered = globalThis.wx.modelContext._registered;
const names = Object.keys(registered).sort();
const EXPECTED = ['addCost', 'addRefuel', 'queryCars', 'queryMaintain', 'queryStats'];
console.log('registered:', names.join(', '));
if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) {
  console.error('FAIL: 注册的接口名不对，期望', EXPECTED.join(', '));
  process.exit(1);
}

// ---- 铺数据 ----
const NOW = new Date(2026, 10, 19).getTime();
const CAR = 'mp:cars:1';
function put(table, e) {
  memory.set(`icar:${table}:${e.sourceId}`, e);
  const idx = memory.get('icar:index') || {};
  (idx[table] = idx[table] || []).push(e.sourceId);
  memory.set('icar:index', idx);
}
memory.set('icar:user', { pinnedCarId: CAR });
put('cars', {
  sourceId: CAR, name: '我的 CRV', energyType: 'fuel',
  initDate: NOW, initMileages: 0, mileages: 5850,
  maintainSoonMileage: 500, maintainSoonDays: 15
});
put('categories', { sourceId: 'mp:cat:1', name: '停车', visible: true, presetType: '' });
// 加油记录要靠系统预设类别归类（presetType=refuel），库里没有就记不了
put('categories', { sourceId: 'mp:cat:fuel', name: '加油', visible: true, presetType: 'refuel' });
put('costs', {
  sourceId: 'mp:costs:1', carSourceId: CAR, categorySourceId: 'mp:cat:1',
  amount: 300, costDate: NOW, remark: '', maintainHandleSourceId: '',
  repairSourceId: '', fuelRecordSourceId: ''
});
put('maintains', {
  sourceId: 'mp:m:oil', carSourceId: CAR, name: '机油机滤',
  cycleMileages: 5000, cycleDays: 0, cycleMonths: 0, cycleUnit: 'mileage',
  cycleValue: 5000, mileageSource: 'total', sortOrder: 0
});

(async () => {
  const cars = await registered.queryCars({});
  console.log('queryCars:', cars.content[0].text);
  if (cars.structuredContent.count !== '1') {
    console.error('FAIL: 车辆数 =', cars.structuredContent.count);
    process.exit(1);
  }

  const refuel = await registered.addRefuel({ volume: 40, amount: 320, mileage: 6250 });
  console.log('addRefuel:', refuel.content[0].text);
  if (refuel.isError) {
    console.error('FAIL: addRefuel 返回错误');
    process.exit(1);
  }
  // 加油应当同时写入关联支出：300 + 320 = 620
  const afterRefuel = await registered.queryStats({ rangeType: 'all' });
  if (afterRefuel.structuredContent.totalExpense !== '620.00') {
    console.error('FAIL: 加油未同步写入支出 =', afterRefuel.structuredContent.totalExpense);
    process.exit(1);
  }

  const stats = await registered.queryStats({ rangeType: 'all' });
  console.log('queryStats:', stats.content[0].text);
  if (stats.structuredContent.totalExpense !== '620.00') {
    console.error('FAIL: totalExpense =', stats.structuredContent.totalExpense);
    process.exit(1);
  }

  const maintain = await registered.queryMaintain({});
  console.log('queryMaintain:', maintain.content[0].text);
  if (!maintain.content[0].text.includes('超期')) {
    console.error('FAIL: 应包含超期提示');
    process.exit(1);
  }

  const add = await registered.addCost({ amount: 15, categoryName: '停车' });
  console.log('addCost:', add.content[0].text);
  if (add.isError || !add.content[0].text.includes('已记录')) {
    console.error('FAIL: addCost 未成功');
    process.exit(1);
  }

  // 初始 300 + 加油 320 + 停车 15 = 635
  const stats2 = await registered.queryStats({ rangeType: 'all' });
  if (stats2.structuredContent.totalExpense !== '635.00') {
    console.error('FAIL: 记账后统计未更新 =', stats2.structuredContent.totalExpense);
    process.exit(1);
  }

  console.log('\nSMOKE OK：编译产物可加载、三接口可执行、口径正确');
})();
