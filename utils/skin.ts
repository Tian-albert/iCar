// 界面皮肤：三套色板 + 运行时注入
//
// 设计约束：**只换颜色令牌，不动任何布局**。
// 实现方式：把令牌拼成 `page-style` 字符串交给各页面的 `<page-meta>`，
// 变量落在 `page` 节点上，全页继承 —— 不需要改任何 WXML 结构或 WXSS 规则。
//
// 为什么不用「给根节点挂 class」：那样每个页面都要改根节点，
// 且 `page` 自身的背景色拿不到子节点的变量；`page-meta` 直接作用于 `page` 节点，更彻底。
import { SkinKey } from '../types/models';
import { getStorage } from '../store/index';
import { CHART_THEME } from './chart-draw';

/** 皮肤展示名（设置页与调试复用） */
export const SKIN_LABEL: Record<SkinKey, string> = {
  a: '极简线稿',
  b: '杂志封面',
  c: '深色运动'
};

/** 设置页展示顺序 */
export const SKIN_ORDER: SkinKey[] = ['a', 'b', 'c'];

/**
 * 三套令牌。
 *
 * 变量名与 `app.wxss` 的 `page{}` 完全一致，落地时直接覆盖即可；
 * 新增令牌时三套都要补齐，否则切换后会出现「某个颜色没变」的割裂感。
 */
export const SKIN_TOKENS: Record<SkinKey, Record<string, string>> = {
  // A 极简线稿：纯白 + 近黑字 + 极淡分隔线
  a: {
    '--color-bg': '#FFFFFF',
    '--color-card': '#FFFFFF',
    '--color-text-1': '#11151C',
    '--color-text-2': '#5A6272',
    // 必须与 app.wxss 的 page{} 同值：此处若写旧值 #8A93A6，
    // 运行时的 page-style 会覆盖全局，等于撤销 2026-11-15 的对比度修复（3.09:1 → 4.70:1）
    '--color-text-3': '#6B7486',
    '--color-text-4': '#8A93A6',
    '--color-divider': '#F0F1F4',
    '--color-fill': '#F2F3F5',
    '--color-border': '#E6EAF1',
    '--color-primary': '#3B6FF6',
    '--color-primary-light': '#EEF3FE',
    '--color-primary-dark': '#1D4ED8',
    '--color-danger': '#F5474F',
    '--color-success': '#2BA84A',
    '--color-success-bg': '#E8F7EE',
    '--color-warning': '#E8912A',
    '--color-warning-bg': '#FFF3E0',
    '--color-dark-card': '#1E2536',
    '--color-on-dark': '#FFFFFF',
    '--color-on-dark-sub': '#A9ACB2',
    '--color-on-dark-weak': '#737882',
    '--chart-grid': '#EEF0F3',
    '--chart-axis': '#9AA4B2'
  },
  // B 杂志封面：暖米白纸感 + 近黑字 + 陶土红强调
  b: {
    '--color-bg': '#F7F5F0',
    '--color-card': '#FFFFFF',
    '--color-text-1': '#161616',
    '--color-text-2': '#5C574C',
    // 原 #9A9384 在米白底 #F7F5F0 上仅 2.88:1，加深到约 4.7:1
    '--color-text-3': '#746D5F',
    '--color-text-4': '#A8A192',
    '--color-divider': '#E6E0D4',
    '--color-fill': '#EDE9E0',
    '--color-border': '#DED7C8',
    '--color-primary': '#B4471A',
    '--color-primary-light': '#F6EEE6',
    '--color-primary-dark': '#8E3213',
    '--color-danger': '#B4342A',
    '--color-success': '#2C7A3F',
    '--color-success-bg': '#EAF2E6',
    '--color-warning': '#9A6B12',
    '--color-warning-bg': '#F6EFE0',
    '--color-dark-card': '#1F1B16',
    '--color-on-dark': '#FFFFFF',
    '--color-on-dark-sub': '#A9ACB2',
    '--color-on-dark-weak': '#737882',
    '--chart-grid': '#E6E0D4',
    '--chart-axis': '#A8A192'
  },
  // C 深色运动：近黑底 + 深灰卡 + 提亮蓝（深色底上原品牌蓝对比度不足）
  c: {
    '--color-bg': '#0E1116',
    '--color-card': '#161B22',
    '--color-text-1': '#FFFFFF',
    '--color-text-2': '#B6BECD',
    '--color-text-3': '#8A93A6',
    '--color-text-4': '#7A8394',
    '--color-divider': 'rgba(255,255,255,0.12)',
    '--color-fill': 'rgba(255,255,255,0.10)',
    '--color-border': 'rgba(255,255,255,0.14)',
    '--color-primary': '#5B8CFF',
    '--color-primary-light': 'rgba(91,140,255,0.16)',
    '--color-primary-dark': '#3B6FF6',
    '--color-danger': '#FF7B81',
    '--color-success': '#4ADE80',
    '--color-success-bg': 'rgba(74,222,128,0.14)',
    '--color-warning': '#FFB35C',
    '--color-warning-bg': 'rgba(255,179,92,0.14)',
    '--color-dark-card': '#1C2430',
    // 深色卡比页面底色更亮一档，白字在任何深色皮肤下都能读
    '--color-on-dark': '#FFFFFF',
    '--color-on-dark-sub': '#AFB6C4',
    '--color-on-dark-weak': '#79808F',
    '--chart-grid': 'rgba(255,255,255,0.10)',
    '--chart-axis': '#7A8394'
  }
};

/** 当前皮肤；User 缺失或字段异常时回落到 A */
export function getSkin(): SkinKey {
  const raw = getStorage().getUser()?.skin;
  return raw === 'b' || raw === 'c' ? raw : 'a';
}

/**
 * 写入皮肤偏好（User 单例）。
 *
 * User 记录正常由迁移保证存在；真缺失时静默返回（不补建），
 * 因为补建需要填齐十余个字段，写错反而会污染数据。
 */
export function setSkin(skin: SkinKey): void {
  const storage = getStorage();
  const user = storage.getUser();
  if (!user) return;
  if (user.skin === skin) return;
  user.skin = skin;
  user.updatedAt = Date.now();
  storage.setUser(user);
}

/** 拼成 `page-style` 字符串：`--color-bg:#fff;--color-card:#fff;...` */
export function buildPageStyle(skin: SkinKey): string {
  const tokens = SKIN_TOKENS[skin] || SKIN_TOKENS.a;
  return Object.keys(tokens)
    .map(k => `${k}:${tokens[k]}`)
    .join(';') + ';';
}

/**
 * 同步原生外壳：导航栏与窗口底色不吃 CSS 变量，只能走 API。
 *
 * 不同步的话，深色皮肤会出现「内容全黑、顶部导航栏还是白的」的割裂感。
 * frontColor 只接受 #ffffff / #000000，所以按键值而不是精确色值判断。
 */
function applyNativeChrome(skin: SkinKey): void {
  const api: any = typeof wx !== 'undefined' ? wx : null;
  if (!api) return;

  const isDark = skin === 'c';
  const bg = isDark ? '#0E1116' : skin === 'b' ? '#F7F5F0' : '#FFFFFF';

  if (typeof api.setNavigationBarColor === 'function') {
    api.setNavigationBarColor({
      frontColor: isDark ? '#ffffff' : '#000000',
      backgroundColor: bg,
      fail: () => {
        // 自定义导航栏的页面会失败，忽略即可
      }
    });
  }
  if (typeof api.setBackgroundColor === 'function') {
    // 下拉回弹露出的窗口底色
    api.setBackgroundColor({
      backgroundColor: bg,
      backgroundColorTop: bg,
      backgroundColorBottom: bg,
      fail: () => {}
    });
  }
}

/**
 * 把当前皮肤写进页面的 `pageStyle`。
 * 每个页面都有 `<page-meta page-style="{{pageStyle}}" />`，这里只负责喂值。
 */
export function applyPageSkin(page: any): void {
  if (!page || typeof page.setData !== 'function') return;
  const skin = getSkin();
  applyNativeChrome(skin);

  const style = buildPageStyle(skin);
  // 同值不重复 setData，避免 onShow 每次触发一次无谓渲染
  if (page.data && page.data.pageStyle === style) return;
  page.setData({ pageStyle: style });
}

/** 图表主题跟随皮肤（Canvas 不读 CSS 变量，只能显式同步） */
export function applyChartTheme(skin: SkinKey): void {
  const t = SKIN_TOKENS[skin] || SKIN_TOKENS.a;
  CHART_THEME.primary = t['--color-primary'];
  CHART_THEME.primaryDark = t['--color-primary-dark'];
  CHART_THEME.card = t['--color-card'];
  CHART_THEME.text1 = t['--color-text-1'];
  CHART_THEME.text3 = t['--color-text-3'];
  CHART_THEME.label = t['--color-text-2'];
  CHART_THEME.grid = t['--chart-grid'];
  CHART_THEME.border = t['--color-border'];
  // 气泡阴影：浅色皮肤用淡蓝黑，深色皮肤用纯黑（深底上淡阴影看不见）
  CHART_THEME.shadow = skin === 'c' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(15, 23, 42, 0.10)';
}

/**
 * 页面钩子：给 `Page()` 套一层，统一在 `onShow` 注入皮肤。
 *
 * 为什么不逐个页面加 onShow：22 个页面各加一次容易漏、也更难维护；
 * 这里只在 `Page` 注册时包一层，页面代码零改动。
 */
let patched = false;
export function installSkinPatch(): void {
  if (patched) return;

  const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
  const original = g.Page;
  // 拿不到 Page 说明不在小程序运行时（如单测环境）。
  // 这里**不能**提前把 patched 置 true，否则真机上永远不会再有机会补装。
  if (typeof original !== 'function') return;

  g.Page = function (options: any) {
    const userOnLoad = options && options.onLoad;
    const userOnShow = options && options.onShow;

    /**
     * onLoad 也注入一次：它早于首次渲染，
     * 否则深色皮肤下进入新页面会先闪一帧浅色底。
     */
    options.onLoad = function (this: any, ...args: any[]) {
      applySkinToPage(this);
      if (typeof userOnLoad === 'function') userOnLoad.apply(this, args);
    };

    options.onShow = function (this: any, ...args: any[]) {
      // 切肤后返回上一页，onShow 负责把新令牌补上
      applySkinToPage(this);
      if (typeof userOnShow === 'function') userOnShow.apply(this, args);
    };

    return original(options);
  };

  patched = true;
}

/** 同步图表主题 + 注入 page-style，供 onLoad / onShow 复用 */
function applySkinToPage(page: any): void {
  const skin = getSkin();
  applyChartTheme(skin);
  applyPageSkin(page);
}
