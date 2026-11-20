// 全部页面的运行时冒烟：真正注册 Page、构造实例、跑 onLoad/onShow/onReady。
//
// 这是唯一能挡住「源码引用了未定义变量」这类问题的手段 ——
// 单靠读文件的字符串断言，`load()` 里的 `segIndexOf is not defined`
// 在单测里完全看不出来，只有真机白屏时才暴露。
import {
  installWx,
  resetStorage,
  resetDrawnTexts,
  drawnTexts,
  seedFixture,
  smokePage,
  loadPage,
  loadComponent,
  makePageInstance,
  makeComponentInstance,
  currentAdapter,
  FixtureIds
} from './helpers/page-harness';

let demo: FixtureIds;

beforeAll(() => {
  resetStorage();
  installWx();
  demo = seedFixture();
});

beforeEach(() => {
  // 每个用例前重置「画了什么」的记录；数据保留（冒烟不写库）
  resetDrawnTexts();
  installWx();
});

interface PageCase {
  name: string;
  path: string;
  options: (d: FixtureIds) => Record<string, any>;
}

/**
 * 21 个页面。有的页面需要 route 参数，按各自 onLoad 实际读取的字段给。
 * 参数给全一点，才能让「有数据」的分支真正跑起来。
 */
const PAGE_CASES: PageCase[] = [
  { name: 'reminder（概览）', path: 'pages/reminder/index', options: () => ({}) },
  { name: 'index（车辆）', path: 'pages/index/index', options: () => ({}) },
  { name: 'user（设置）', path: 'pages/user/index', options: () => ({}) },
  { name: 'faq（常见问题）', path: 'pages/faq/index', options: () => ({}) },
  { name: 'changelog（更新日志）', path: 'pages/changelog/index', options: () => ({}) },
  { name: 'about', path: 'pages/about/index', options: () => ({}) },
  { name: 'privacy', path: 'pages/privacy/index', options: () => ({}) },
  { name: 'category-manage', path: 'pages/category-manage/index', options: () => ({}) },
  { name: 'data-transfer', path: 'pages/data-transfer/index', options: () => ({}) },
  { name: 'recycle-bin', path: 'pages/recycle-bin/index', options: () => ({}) },
  {
    name: 'entry（快捷记账）',
    path: 'pages/entry/index',
    options: d => ({ carId: d.carId, tab: 'cost' })
  },
  {
    name: 'statistics',
    path: 'pages/statistics/index',
    options: d => ({ id: d.carId, range: 'year' })
  },
  {
    // 非 tabBar 页：AI 接力落点，必须能用 query 还原区间
    name: 'summary（数据总览）',
    path: 'pages/summary/index',
    options: () => ({ rangeType: 'month', year: 2026, month: 3 })
  },
  {
    name: 'vehicle-detail',
    path: 'pages/vehicle-detail/index',
    options: d => ({ id: d.carId, section: 'maintain' })
  },
  {
    name: 'vehicle-form（编辑）',
    path: 'pages/vehicle-form/index',
    options: d => ({ id: d.carId })
  },
  {
    name: 'cost-form（编辑）',
    path: 'pages/cost-form/index',
    options: d => ({ carId: d.carId, recordId: d.costId })
  },
  {
    name: 'refuel-form（编辑）',
    path: 'pages/refuel-form/index',
    options: d => ({ carId: d.carId, recordId: d.refuelId })
  },
  {
    name: 'maintain-form（编辑）',
    path: 'pages/maintain-form/index',
    options: d => ({ carId: d.carId, recordId: d.maintainHandleId })
  },
  {
    name: 'repair-form（编辑）',
    path: 'pages/repair-form/index',
    options: d => ({ carId: d.carId, recordId: d.repairId })
  },
  {
    name: 'maintain-manage',
    path: 'pages/maintain-manage/index',
    options: d => ({ id: d.carId })
  },
  {
    name: 'maintain-all（全车保养）',
    path: 'pages/maintain-all/index',
    options: () => ({})
  },
  {
    name: 'maintain-threshold',
    path: 'pages/maintain-threshold/index',
    options: d => ({ id: d.carId })
  },
  {
    name: 'maintain-item-form（新增）',
    path: 'pages/maintain-item-form/index',
    options: d => ({ carId: d.carId })
  },
  {
    name: 'records',
    path: 'pages/records/index',
    options: d => ({ id: d.carId, tab: 'fuel' })
  },
  {
    name: 'icon-crop',
    path: 'pages/icon-crop/index',
    options: () => ({ src: 'harness.png' })
  }
];

describe('页面运行时冒烟：生命周期不抛错', () => {
  PAGE_CASES.forEach(c => {
    it(`${c.name} 能完成 onLoad → onShow → onReady`, () => {
      expect(() => smokePage(c.path, c.options(demo))).not.toThrow();
    });
  });

  it('覆盖了 app.json 里的全部页面', () => {
    const app = JSON.parse(require('fs').readFileSync('app.json', 'utf-8'));
    const listed = PAGE_CASES.map(c => c.path).sort();
    const declared = (app.pages as string[])
      .map(p => `${p}.ts`)
      .map(p => p)
      .sort();
    const missing = (app.pages as string[]).filter(
      p => listed.indexOf(p) < 0
    );
    // 新增页面时这里会提醒补一条冒烟用例
    expect(missing).toEqual([]);
    expect(declared.length).toBe(listed.length);
  });
});

describe('概览页环图真的被绘制', () => {
  it('drawDonut 执行后留下了中心金额与标签文字', () => {
    resetDrawnTexts();
    const inst = smokePage('pages/reminder/index', {});
    const texts = drawnTexts();

    // 环图中心金额 + 外标签（车名/百分比）至少要有几条
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.some(t => t.indexOf('¥') >= 0)).toBe(true);
    // 扇区数据也应当就位
    expect(Array.isArray(inst.data.donutSegments)).toBe(true);
    expect(inst.data.donutSegments.length).toBeGreaterThan(0);
  });

  it('布局缓存已写入（供点击命中判定使用）', () => {
    installWx();
    const inst = smokePage('pages/reminder/index', {});
    // drawDonut 会把布局挂在实例上，点击时用它换算坐标
    expect(inst._donutLayout).toBeTruthy();
    expect(inst._donutLayout.valid).toBe(true);
  });
});

describe('自定义底栏：点击切换 tab 能真正执行', () => {
  it('switchTab 调用 wx.switchTab 并更新选中态', () => {
    installWx({ switchTab: jest.fn() });
    const cfg = loadComponent('custom-tab-bar/index');
    const inst = makeComponentInstance(cfg);

    cfg.methods.switchTab.call(inst, {
      currentTarget: { dataset: { index: 1, path: '/pages/index/index' } }
    });

    expect((globalThis as any).wx.switchTab).toHaveBeenCalledWith({
      url: '/pages/index/index'
    });
    expect(inst.data.selected).toBe(1);
  });

  it('缺 path 时不动（防止误跳空页）', () => {
    installWx({ switchTab: jest.fn() });
    const cfg = loadComponent('custom-tab-bar/index');
    const inst = makeComponentInstance(cfg);

    cfg.methods.switchTab.call(inst, { currentTarget: { dataset: { index: 2 } } });
    expect((globalThis as any).wx.switchTab).not.toHaveBeenCalled();
  });
});

describe('回收站：恢复与清理能真正执行', () => {
  it('onRestore 确认后把该批次记录恢复回来', () => {
    const session: any = { confirmed: false };
    installWx({
      // 让弹窗自动点「确定」，同时记下确实弹过
      showModal: jest.fn((o: any) => {
        session.confirmed = true;
        if (o && o.success) o.success({ confirm: true });
      })
    });

    const adapter = currentAdapter();
    const { removeCost, listCosts } = require('../services/cost.service');
    const { listRecycleBatches } = require('../services/recycle.service');

    const target = listCosts(adapter, demo.carId)[0];
    expect(target).toBeTruthy();
    removeCost(adapter, target.sourceId);

    const batches = listRecycleBatches(adapter);
    expect(batches.length).toBeGreaterThan(0);

    const cfg = loadPage('pages/recycle-bin/index');
    const inst = makePageInstance(cfg);
    cfg.onShow.call(inst);
    expect(inst.data.items.length).toBeGreaterThan(0);

    cfg.onRestore.call(inst, {
      currentTarget: { dataset: { batch: batches[0].batch } }
    });

    expect(session.confirmed).toBe(true);
    const restored = listCosts(adapter, demo.carId).filter(
      (c: any) => c.sourceId === target.sourceId
    );
    expect(restored.length).toBe(1);
  });

  it('onPurge 清空过期项不抛错', () => {
    installWx();
    const cfg = loadPage('pages/recycle-bin/index');
    const inst = makePageInstance(cfg);
    expect(() => cfg.onPurge.call(inst)).not.toThrow();
  });
});
