// 「概览」Tab 与区块跳转的契约。
//
// 覆盖两类容易回退的问题：
// 1. 改名只改了 TabBar，忘了页面顶部导航标题（app.json 的 tabBar.list 与
//    页面 json 的 navigationBarTitleText 是三处独立配置）。
// 2. 概览页带了 section 参数，但车辆详情页没有对应锚点，点击后停在首屏。
const fsx = require('fs') as any;

function read(p: string): string {
  return fsx.readFileSync(p, 'utf-8');
}

/** 收集所有匹配的第一个捕获组（项目 lib 为 ES2017，不能用 String.matchAll） */
function collect(src: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.push(m[1]);
  }
  return out;
}

describe('「概览」改名三处必须一致', () => {
  it('app.json 的 tabBar.list 文案为「概览」', () => {
    const app = JSON.parse(read('app.json'));
    const item = app.tabBar.list.filter((x: any) => x.text === '概览')[0];
    expect(item).toBeTruthy();
    expect(item.text).toBe('概览');
  });

  it('「概览」是启动首页，且在 app.json 的 pages 首项', () => {
    const app = JSON.parse(read('app.json'));
    expect(app.pages[0]).toBe('pages/tab-overview/index');
  });

  it('自定义 TabBar 文案与图标同步', () => {
    const src = read('custom-tab-bar/index.ts');
    expect(src).toContain("text: '概览'");
    // 图标已从 emoji 改为手绘 SVG 的 data URI（见 utils/tab-icons.ts）
    expect(src).toContain("icon: 'overview'");
    expect(src).not.toContain("text: '保养'");
  });

  it('自定义 TabBar 与 app.json 的 tabBar 路径一致', () => {
    const app = JSON.parse(read('app.json'));
    const item = app.tabBar.list.filter((x: any) => x.text === '概览')[0];
    expect(item.pagePath).toBe('pages/tab-overview/index');

    const src = read('custom-tab-bar/index.ts');
    expect(src).toContain("pagePath: '/pages/tab-overview/index'");
  });
});

describe('车辆详情页的区块锚点', () => {
  const wxml = read('pages/vehicle-detail/index.wxml');

  it('三个锚点 id 都存在', () => {
    expect(wxml).toContain('id="sec-maintain"');
    expect(wxml).toContain('id="sec-records"');
    expect(wxml).toContain('id="sec-costs"');
  });

  it('锚点数量不重复（避免 selector 命中错误节点）', () => {
    for (const id of ['sec-maintain', 'sec-records', 'sec-costs']) {
      const n = (wxml.match(new RegExp(`id="${id}"`, 'g')) || []).length;
      expect(n).toBe(1);
    }
  });

  it('锚点在页面根 WXML 上，不在自定义组件内（pageScrollTo selector 只认页面节点）', () => {
    const pageJson = JSON.parse(read('pages/vehicle-detail/index.json'));
    // 该页不引入自定义组件，因此 WXML 里的节点都是页面级
    expect(Object.keys(pageJson.usingComponents || {}).length).toBe(0);
  });
});

describe('详情页消费 section 参数', () => {
  const src = read('pages/vehicle-detail/index.ts');

  it('onLoad 读取 section 参数', () => {
    expect(src).toContain('targetSection');
    expect(src).toMatch(/options\.section/);
  });

  it('三个 section 都映射到对应锚点', () => {
    expect(src).toMatch(/maintain:\s*'#sec-maintain'/);
    expect(src).toMatch(/records:\s*'#sec-records'/);
    expect(src).toMatch(/costs:\s*'#sec-costs'/);
  });

  it('滚动只执行一次（消费后清空，避免 onShow 重复滚动）', () => {
    expect(src).toContain("this.setData({ targetSection: '' })");
  });

  it('load 结束时才滚动（否则目标节点尚未渲染）', () => {
    const idx = src.indexOf('this.scrollToSection()');
    expect(idx).toBeGreaterThan(0);
    // 必须在 load 内、setData 之后
    const loadIdx = src.indexOf('load() {');
    expect(idx).toBeGreaterThan(loadIdx);
  });

  it('滚动失败静默，不弹错误（该车可能没有对应记录导致区块未渲染）', () => {
    expect(src).toMatch(/fail:\s*\(\)\s*=>\s*\{\s*\}/);
  });
});

describe('概览页跳转参数与详情页契约对齐', () => {
  it('概览页只使用详情页支持的三种 section', () => {
    const src = read('components/tab-overview/index.ts');
    const used = collect(src, /section=([a-z]+)/g);
    const allowed = ['maintain', 'records', 'costs'];
    // 静态 URL 里的 section 值（onTapRecord 是动态拼的，单独校验默认值）
    for (const u of used) {
      expect(allowed).toContain(u);
    }
    // onTapRecord 的兜底默认值必须在白名单内
    const fallback = /dataset\.section as string\) \|\| '([a-z]+)'/.exec(src);
    expect(fallback).toBeTruthy();
    expect(allowed).toContain(fallback![1]);
  });

  it('服务层产出的 section 值也在白名单内', () => {
    const src = read('services/overview.service.ts');
    const allowed = ['maintain', 'records', 'costs'];
    const found = collect(src, /section: '([a-z]+)'/g);
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(allowed).toContain(f);
  });
});
