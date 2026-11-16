// 页面 / 组件的运行时测试脚手架。
//
// 为什么需要它：项目里绝大多数测试只做「读文件 + 字符串断言」，
// 页面逻辑一次都没被执行过。结果就是 `load()` 里引用一个不存在的变量
// （`segIndexOf is not defined`）时单测全绿、真机白屏。
//
// 做法：把 `wx` 用内存实现顶掉（存储、导航、弹窗、canvas 全部可用），
// 然后真正 `Page({...})` / `Component({...})` 注册、构造实例、调用生命周期。
// 任何未定义标识符、错误的方法调用都会立刻抛错。

const pathx = require('path') as any;

const STORE_KEY = '__harnessWxStore';
const TEXTS_KEY = '__harnessCtxTexts';

/** 每次运行时新建的固定尺寸，避免各页面行为差异 */
const WINDOW = { windowWidth: 375, windowHeight: 667, pixelRatio: 2 };

function storeMap(): Map<string, any> {
  const g: any = globalThis;
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map<string, any>();
  return g[STORE_KEY];
}

/** 清空本地存储（模拟「清缓存 → 清除全部数据」） */
export function resetStorage(): void {
  storeMap().clear();
}

/** 上一次 canvas 绘制写下的文字，供断言「图表真的画了」 */
export function drawnTexts(): string[] {
  const g: any = globalThis;
  if (!g[TEXTS_KEY]) g[TEXTS_KEY] = [];
  return g[TEXTS_KEY];
}

export function resetDrawnTexts(): void {
  (globalThis as any)[TEXTS_KEY] = [];
}

function makeCtx(): any {
  const texts = drawnTexts();
  const state: any = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: ''
  };
  const ctx: any = {
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    transform: () => undefined,
    setTransform: () => undefined,
    resetTransform: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    arcTo: () => undefined,
    rect: () => undefined,
    quadraticCurveTo: () => undefined,
    bezierCurveTo: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    clip: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    clearRect: () => undefined,
    drawImage: () => undefined,
    setLineDash: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => null,
    fillText: (t: string) => { texts.push(String(t)); },
    strokeText: (t: string) => { texts.push(String(t)); },
    // 宽度按字符数粗估即可：调用方只用它判断是否要缩字号
    measureText: (t: string) => ({ width: String(t).length * 8 }),
    getImageData: () => ({ data: [] }),
    putImageData: () => undefined
  };
  Object.keys(state).forEach(k => {
    Object.defineProperty(ctx, k, {
      get: () => state[k],
      set: (v: any) => { state[k] = v; }
    });
  });
  return ctx;
}

/** 一次性的假画布节点 */
function makeCanvas(w = 335, h = 186): any {
  return {
    width: w,
    height: h,
    getContext: () => makeCtx(),
    // 刻意不让 src 触发 onload：图片异步链路在冒烟测试里不需要跑完，
    // 一旦触发会在测试结束后回调，反而制造噪音
    createImage: () => ({ width: w, height: h, set src(_v: string) {} }),
    toTempFilePath: (o: any) => { if (o && o.success) o.success({ tempFilePath: 'harness.png' }); }
  };
}

/** SelectorQuery 的链式假实现：select/fields/exec/boundingClientRect 都能走通 */
function makeQuery(): any {
  const rect = { width: 335, height: 186, left: 0, top: 0, right: 335, bottom: 186 };
  const result = [{ node: makeCanvas(), ...rect }];
  const chain: any = {
    fields: () => chain,
    node: () => chain,
    boundingClientRect: (cb?: any) => { if (cb) cb(rect); return chain; },
    scrollOffset: (cb?: any) => { if (cb) cb({ scrollLeft: 0, scrollTop: 0 }); return chain; },
    exec: (cb?: any) => { if (cb) cb(result); }
  };
  const query: any = {
    select: () => chain,
    selectAll: () => chain,
    selectViewport: () => chain,
    in: () => query,
    exec: (cb?: any) => { if (cb) cb(result); }
  };
  return query;
}

function noop(): void {
  /* 空实现 */
}

/**
 * 安装内存版 `wx`。
 *
 * overrides 用于个别用例定制（例如让它自动确认弹窗）。
 */
export function installWx(overrides: Record<string, any> = {}): any {
  const store = storeMap();
  const wx: any = {
    // ---- 存储：内存实现，语义对齐真实 wx（缺失键返回空字符串）----
    getStorageSync: (k: string) => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k: string, v: any) => { store.set(k, v); },
    removeStorageSync: (k: string) => { store.delete(k); },
    getStorageInfoSync: () => ({
      keys: Array.from(store.keys()),
      currentSize: 0,
      limitSize: 10240
    }),

    // ---- 环境 ----
    getWindowInfo: () => ({ ...WINDOW }),
    getSystemInfoSync: () => ({ ...WINDOW }),
    canIUse: () => true,
    env: { USER_DATA_PATH: 'wxfile://usr' },

    // ---- 渲染 ----
    createSelectorQuery: () => makeQuery(),
    createOffscreenCanvas: () => makeCanvas(),
    canvasToTempFilePath: (o: any) => { if (o && o.success) o.success({ tempFilePath: 'harness.png' }); },
    getImageInfo: (o: any) => { if (o && o.success) o.success({ width: 100, height: 100, path: 'harness.png' }); },

    // ---- 文件 ----
    getFileSystemManager: () => ({
      readdirSync: () => [],
      accessSync: noop,
      unlinkSync: noop,
      mkdirSync: noop,
      readFileSync: () => '',
      writeFileSync: noop,
      copyFileSync: noop,
      statSync: () => ({ isDirectory: () => false, isFile: () => true, size: 0 })
    }),

    // ---- 反馈 ----
    showToast: jest.fn(),
    hideToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showModal: jest.fn(),
    showActionSheet: jest.fn(),

    // ---- 导航 ----
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
    switchTab: jest.fn(),
    setNavigationBarTitle: jest.fn(),
    pageScrollTo: jest.fn(),
    stopPullDownRefresh: jest.fn(),

    // ---- 其它 ----
    vibrateShort: jest.fn(),
    setClipboardData: jest.fn(),
    previewImage: jest.fn(),
    showShareMenu: jest.fn(),
    showShareImageMenu: jest.fn(),
    shareFileMessage: jest.fn(),
    chooseMedia: jest.fn(),
    chooseMessageFile: jest.fn(),
    openDocument: jest.fn(),
    saveFileToDisk: jest.fn(),
    requirePrivacyAuthorize: jest.fn(),
    onWindowResize: jest.fn(),
    offWindowResize: jest.fn()
  };
  const merged = Object.assign(wx, overrides);
  (globalThis as any).wx = merged;
  return merged;
}

/** 注册页面并返回其配置对象 */
export function loadPage(pagePath: string): any {
  let cfg: any = null;
  (globalThis as any).Page = (c: any) => { cfg = c; };
  jest.isolateModules(() => {
    require(pathx.join(pathx.resolve('.'), pagePath));
  });
  if (!cfg) throw new Error(`页面没有调用 Page()：${pagePath}`);
  return cfg;
}

/** 注册组件并返回其配置对象 */
export function loadComponent(compPath: string): any {
  let cfg: any = null;
  (globalThis as any).Component = (c: any) => { cfg = c; };
  jest.isolateModules(() => {
    require(pathx.join(pathx.resolve('.'), compPath));
  });
  if (!cfg) throw new Error(`组件没有调用 Component()：${compPath}`);
  return cfg;
}

/**
 * 构造页面实例。
 *
 * 必须展开 cfg：真机上 `this` 是带全部方法的页面实例，
 * 页面内部会调 `this.drawDonut()`、`this.load()` 等，少方法就会误报。
 */
export function makePageInstance(cfg: any, dataPatch: Record<string, any> = {}): any {
  return {
    ...cfg,
    data: Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), dataPatch),
    setData(patch: any, cb?: () => void) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    },
    createSelectorQuery: () => makeQuery(),
    createIntersectionObserver: () => ({ relativeToViewport: () => ({ observe: noop, disconnect: noop }) }),
    getTabBar: () => null,
    getOpenerEventChannel: () => ({ emit: jest.fn(), on: jest.fn() }),
    selectComponent: () => null,
    route: 'harness'
  };
}

/** 构造组件实例（方法在 cfg.methods 里，需要展开到实例上） */
export function makeComponentInstance(cfg: any, dataPatch: Record<string, any> = {}): any {
  return {
    ...(cfg.methods || {}),
    data: Object.assign(JSON.parse(JSON.stringify(cfg.data || {})), dataPatch),
    setData(patch: any, cb?: () => void) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    },
    createSelectorQuery: () => makeQuery(),
    triggerEvent: jest.fn(),
    route: 'harness'
  };
}

/**
 * 跑一遍页面生命周期：onLoad → onShow → onReady。
 *
 * 任何未定义标识符 / 错误调用都会直接抛错，这正是我们要拦的。
 */
export function smokePage(pagePath: string, options: Record<string, any> = {}): any {
  const cfg = loadPage(pagePath);
  const inst = makePageInstance(cfg);
  if (typeof cfg.onLoad === 'function') cfg.onLoad.call(inst, options);
  if (typeof cfg.onShow === 'function') cfg.onShow.call(inst);
  if (typeof cfg.onReady === 'function') cfg.onReady.call(inst);
  return inst;
}

export interface FixtureIds {
  carId: string;
  costId: string;
  refuelId: string;
  maintainHandleId: string;
  repairId: string;
  categoryId: string;
}

/**
 * 用 `test-data/` 里的样本包铺一份完整数据。
 *
 * 走 `importBundle` 而不是逐个调 service：一次就能得到车、加油、保养、
 * 维修、支出与类别，页面需要什么都能拿到。
 */
export function seedFixture(file = 'test-data/icar-test-fuel.json'): FixtureIds {
  const fsx = require('fs') as any;
  const { getStorage } = require('../../store/index');
  const { importBundle } = require('../../services/io.service');

  const adapter = getStorage();
  const json = fsx.readFileSync(pathx.join(pathx.resolve('.'), file), 'utf-8');
  const result = importBundle(adapter, json);
  if (!result.ok) throw new Error(`样本导入失败：${result.message || ''}`);

  const alive = (table: string) =>
    (adapter.list(table) as any[]).filter(x => x && !x.deleted);

  const car = alive('cars')[0];
  const cost = alive('costs')[0];
  const refuel = alive('fuelRecords')[0];
  const handle = alive('maintainHandles')[0];
  const repair = alive('repairRecords')[0];
  const category = alive('categories').filter(c => !c.presetType)[0] || alive('categories')[0];

  return {
    carId: car ? car.sourceId : '',
    costId: cost ? cost.sourceId : '',
    refuelId: refuel ? refuel.sourceId : '',
    maintainHandleId: handle ? handle.sourceId : '',
    repairId: repair ? repair.sourceId : '',
    categoryId: category ? category.sourceId : ''
  };
}

/** 取当前存储适配器（页面已加载过时可直接用） */
export function currentAdapter(): any {
  const { getStorage } = require('../../store/index');
  return getStorage();
}
