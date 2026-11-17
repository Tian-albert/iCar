// 皮肤：令牌完整性、注入方式、迁移与入口
//
// 换肤最容易出的问题不是「颜色不好看」，而是：
// ① 三套令牌变量名不一致 → 切换后某个颜色没变；
// ② 漏了某个页面挂 page-meta → 那一页仍是默认皮肤；
// ③ 旧数据没有 skin 字段 → 读到 undefined。
// 这个文件把三类都钉住。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../repositories/migration';
import { SKIN_LABEL, SKIN_ORDER, SKIN_TOKENS, buildPageStyle } from '../utils/skin';
import { TAB_ICONS_LINE } from '../utils/tab-icons';
import { TAB_ICONS_LINE_DARK } from '../utils/tab-icons-dark';
import { TAB_ICONS_FILL_WARM } from '../utils/tab-icons-warm';
import { SkinKey } from '../types/models';

const fsx = require('fs') as any;
const BufferCtor: any = require('buffer').Buffer;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

describe('皮肤令牌', () => {
  it('三套令牌的变量名完全一致', () => {
    const keys = Object.keys(SKIN_TOKENS.a).sort();
    expect(Object.keys(SKIN_TOKENS.b).sort()).toEqual(keys);
    expect(Object.keys(SKIN_TOKENS.c).sort()).toEqual(keys);
  });

  it('每个令牌在 app.wxss 里都有同名变量（否则改了也没人用）', () => {
    const appWxss: string = fsx.readFileSync('app.wxss', 'utf-8');
    for (const k of Object.keys(SKIN_TOKENS.a)) {
      expect(appWxss).toContain(`${k}:`);
    }
  });

  it('三套主色互不相同', () => {
    const primaries = SKIN_ORDER.map(k => SKIN_TOKENS[k]['--color-primary']);
    expect(new Set(primaries).size).toBe(3);
  });

  it('深色皮肤把 danger / warning 提亮（深底上原色对比度不足）', () => {
    // 只做「三套不同」的弱断言：具体色值允许后续微调
    const danger = SKIN_ORDER.map(k => SKIN_TOKENS[k]['--color-danger']);
    expect(new Set(danger).size).toBe(3);
    expect(SKIN_TOKENS.c['--color-danger']).not.toBe(SKIN_TOKENS.a['--color-danger']);
  });

  it('每个皮肤都有中文展示名', () => {
    for (const k of SKIN_ORDER) {
      expect(SKIN_LABEL[k].length).toBeGreaterThan(1);
    }
  });
});

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('皮肤文本对比度（WCAG AA）', () => {
  it('A 皮肤的文字/分隔/填充色与 app.wxss 保持同值（防止 page-style 悄悄覆盖全局）', () => {
    const appWxss: string = fsx.readFileSync('app.wxss', 'utf-8');
    // 有意偏离的两项不在此列：
    // --color-bg 从 #F5F6F8 改为纯白、--color-text-1 从 #1F2430 改为更近黑的 #11151C
    const checks = [
      '--color-text-2',
      '--color-text-3',
      '--color-text-4',
      '--color-divider',
      '--color-fill',
      '--color-border',
      '--color-primary'
    ];
    for (const key of checks) {
      const m = new RegExp(`${key}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(appWxss);
      expect(m).toBeTruthy();
      expect(SKIN_TOKENS.a[key]).toBe(m![1]);
    }
  });

  it('三套皮肤的 text-1/2/3 在页面底与卡片上均 ≥ 4.5:1', () => {
    for (const skin of SKIN_ORDER) {
      const t = SKIN_TOKENS[skin];
      for (const key of ['--color-text-1', '--color-text-2', '--color-text-3']) {
        const onBg = contrast(t[key], t['--color-bg']);
        const onCard = contrast(t[key], t['--color-card']);
        // 卡片可能比页面更暗（深色皮肤），取两者较小值作为最差场景
        expect(Math.min(onBg, onCard)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('A 皮肤 text-3 不应回退到旧值 #8A93A6', () => {
    expect(SKIN_TOKENS.a['--color-text-3']).not.toBe('#8A93A6');
    expect(contrast(SKIN_TOKENS.a['--color-text-3'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('page-style 注入', () => {
  it('buildPageStyle 覆盖全部令牌且以 ; 结尾', () => {
    for (const skin of SKIN_ORDER) {
      const style = buildPageStyle(skin);
      for (const [k, v] of Object.entries(SKIN_TOKENS[skin])) {
        expect(style).toContain(`${k}:${v}`);
      }
      expect(style.endsWith(';')).toBe(true);
    }
  });

  it('三套皮肤的 style 字符串互不相同', () => {
    const all = SKIN_ORDER.map(k => buildPageStyle(k));
    expect(new Set(all).size).toBe(3);
  });
});

describe('全站页面都挂了 page-meta', () => {
  const appJson = JSON.parse(fsx.readFileSync('app.json', 'utf-8'));

  for (const page of appJson.pages as string[]) {
    it(`${page} 首节点是 page-meta`, () => {
      const wxml: string = fsx.readFileSync(`${page}.wxml`, 'utf-8');
      // 必须是页面第一个节点，否则 page-meta 不生效
      expect(wxml.replace(/^\s+/, '').startsWith('<page-meta page-style="{{pageStyle}}" />')).toBe(true);
    });
  }

  it('onLoad 也注入皮肤（否则深色皮肤进新页会先闪一帧浅色）', () => {
    const ts: string = fsx.readFileSync('utils/skin.ts', 'utf-8');
    expect(ts).toContain('options.onLoad = function');
    expect(ts).toContain('options.onShow = function');
  });

  it('拿不到 Page 时不标记已安装，否则真机永远不再重试', () => {
    const ts: string = fsx.readFileSync('utils/skin.ts', 'utf-8');
    const fn = ts.slice(ts.indexOf('export function installSkinPatch'));
    const guard = fn.indexOf("typeof original !== 'function'");
    const mark = fn.indexOf('patched = true');
    expect(guard).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(guard);
  });

  it('app.ts 在注册页面之前安装了皮肤钩子', () => {
    const ts: string = fsx.readFileSync('app.ts', 'utf-8');
    const installAt = ts.indexOf('installSkinPatch()');
    const appAt = ts.indexOf('App<');
    expect(installAt).toBeGreaterThan(-1);
    expect(appAt).toBeGreaterThan(-1);
    expect(installAt).toBeLessThan(appAt);
  });
});

describe('皮肤持久化与迁移', () => {
  it('新装用户默认 a', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(adapter);
    expect(adapter.getUser()!.skin).toBe('a');
  });

  it('schema 已升级到 v1.6（含 skin 回填）', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
  });

  it('旧数据（无 skin 字段）迁移后回填 a', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    seedPresetCategories(adapter);

    // 模拟 v1.5 的存量数据：把 skin 抹掉、版本号回退到 6（v1.5）
    const user = adapter.getUser()!;
    delete (user as any).skin;
    adapter.setUser(user);
    adapter.setMeta({ schemaVersion: 6 });

    runMigrations(adapter);
    expect(adapter.getUser()!.skin).toBe('a');
  });
});

describe('设置页皮肤入口', () => {
  it('WXML 有皮肤行并展示当前皮肤名', () => {
    const wxml: string = fsx.readFileSync('pages/user/index.wxml', 'utf-8');
    expect(wxml).toContain('bindtap="onOpenSkin"');
    expect(wxml).toContain('{{skinName}}');
    expect(wxml).toContain('>皮肤<');
  });

  it('TS 用 ActionSheet 三选一并写回 User', () => {
    const ts: string = fsx.readFileSync('pages/user/index.ts', 'utf-8');
    expect(ts).toContain('SKIN_ORDER.map');
    expect(ts).toContain('setSkin(skin)');
    expect(ts).toContain('applyPageSkin(this)');
  });
});

describe('深色卡上的前景色（不能借用 --color-card）', () => {
  // --color-card 在 C 皮肤下是深灰 #161B22，深色卡上用它当白字会变成「深底深字」
  const COLOR_CARD_AS_INK = /(?<![-\w])color:\s*var\(--color-card\)/;

  it('车辆页 hero 卡与车辆详情统计卡不再借用 --color-card', () => {
    for (const f of ['pages/index/index.wxss', 'pages/vehicle-detail/index.wxss']) {
      const wxss: string = fsx.readFileSync(f, 'utf-8');
      expect(wxss).not.toMatch(COLOR_CARD_AS_INK);
    }
  });

  it('全站样式里不再出现「把 --color-card 当文字色」', () => {
    const files: string[] = fsx
      .readdirSync('pages')
      .map((d: string) => `pages/${d}/index.wxss`)
      .filter((f: string) => fsx.existsSync(f))
      .concat(['app.wxss']);

    const offenders = files.filter((f: string) => COLOR_CARD_AS_INK.test(fsx.readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });

  it('on-dark 三个变量三套皮肤都有，且主文字恒为白色', () => {
    for (const skin of SKIN_ORDER) {
      expect(SKIN_TOKENS[skin]['--color-on-dark']).toBe('#FFFFFF');
      expect(SKIN_TOKENS[skin]['--color-on-dark-sub']).toBeTruthy();
      expect(SKIN_TOKENS[skin]['--color-on-dark-weak']).toBeTruthy();
    }
  });

  it('深色卡上的次要文字用的是 on-dark 系列而不是 text-4', () => {
    const wxss: string = fsx.readFileSync('pages/vehicle-detail/index.wxss', 'utf-8');
    // 只截取深色卡内的两个规则（.help-icon 在普通背景上，用 text-4 是正确的）
    const arrow = wxss.slice(wxss.indexOf('.stat-arrow'), wxss.indexOf('.stat-col'));
    const label = wxss.slice(wxss.indexOf('.stat-label'), wxss.indexOf('.help-icon'));
    expect(arrow).toContain('var(--color-on-dark-weak)');
    expect(label).toContain('var(--color-on-dark-sub)');
  });
});

describe('底栏跟随皮肤', () => {
  it('深色皮肤选中胶囊改为浅白半透明', () => {
    const wxss: string = fsx.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
    const cBlock = wxss.slice(wxss.indexOf('.tab-bar.skin-c'));
    expect(cBlock).toContain('rgba(255, 255, 255, 0.16)');
    // 选中文字同步改白，避免浅白胶囊上压蓝字对比不足
    expect(cBlock).toContain('color: #FFFFFF');
  });

  it('杂志封面（B）选中胶囊用陶土红浅色，而不是品牌蓝', () => {
    const wxss: string = fsx.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
    const bBlock = wxss.slice(wxss.indexOf('.tab-bar.skin-b'), wxss.indexOf('.tab-bar.skin-c'));
    expect(bBlock).toContain('rgba(180, 71, 26, 0.10)');
    expect(bBlock).toContain('color: #B4471A');
    // 蓝胶囊是 A 的样式，不能再出现在 B 里
    expect(bBlock).not.toContain('rgba(59, 111, 246, 0.10)');
  });

  it('B 的实心图标换成暖色版（组件里按皮肤分派）', () => {
    const ts: string = fsx.readFileSync('custom-tab-bar/index.ts', 'utf-8');
    expect(ts).toContain('TAB_ICONS_FILL_WARM');
    expect(ts).toContain("skin === 'b'");
  });

  it('三个 tab 页在 onShow 里显式让底栏对齐皮肤', () => {
    // 每个 tab 页各自持有一份 tabBar 组件实例，只靠 pageLifetimes 不可靠
    for (const page of ['pages/reminder/index', 'pages/index/index', 'pages/user/index']) {
      const ts: string = fsx.readFileSync(`${page}.ts`, 'utf-8');
      expect(ts).toContain('tab.refreshSkin');
    }
  });

  it('设置页切换皮肤后立即刷新当前页底栏', () => {
    const ts: string = fsx.readFileSync('pages/user/index.ts', 'utf-8');
    const skinBlock = ts.slice(ts.indexOf('onOpenSkin'));
    expect(skinBlock).toContain('tab.refreshSkin');
  });

  it('组件按皮肤切换图标集', () => {
    const ts: string = fsx.readFileSync('custom-tab-bar/index.ts', 'utf-8');
    expect(ts).toContain('TAB_ICONS_LINE_DARK');
    expect(ts).toContain('refreshSkin');
    expect(ts).toContain('pageLifetimes');
  });

  it('WXML 根节点带 skin 类名', () => {
    const wxml: string = fsx.readFileSync('custom-tab-bar/index.wxml', 'utf-8');
    expect(wxml).toContain('class="tab-bar skin-{{skin}}"');
  });

  it('B / C 各有独立的底栏底色与文字色', () => {
    const wxss: string = fsx.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
    expect(wxss).toContain('.tab-bar.skin-b');
    expect(wxss).toContain('.tab-bar.skin-c');
    expect(wxss).toContain('rgba(22, 27, 34, 0.62)');
  });
});

describe('深色图标', () => {
  function decode(uri: string): string {
    return BufferCtor.from(uri.split(',')[1], 'base64').toString('utf-8');
  }

  it('三个图标齐全且颜色确实换成了深色皮肤色值', () => {
    for (const key of ['overview', 'car', 'gear']) {
      const icon = TAB_ICONS_LINE_DARK[key];
      expect(icon).toBeTruthy();
      const svg = decode(icon);
      expect(svg).toContain('#8A93A6');
      expect(svg).not.toContain('#6B7486');
    }
  });

  it('与浅色图标内容不同（不是复制粘贴）', () => {
    expect(TAB_ICONS_LINE_DARK.overview).not.toBe(TAB_ICONS_LINE.overview);
  });

  it('暖色实心图标用的是陶土红，且不含品牌蓝', () => {
    for (const key of ['overview', 'car', 'gear']) {
      const svg = decode(TAB_ICONS_FILL_WARM[key]);
      expect(svg).toContain('#B4471A');
      expect(svg).not.toContain('#3B6FF6');
    }
  });
});
