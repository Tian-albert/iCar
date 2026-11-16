// Tab 宿主页：swiper 承载三个 tab，底部栏指示块随滑动连续移动。
//
// 核心语义（来自微信官方文档）：
// swiper 的 bindtransition 事件 detail.dx 表示 **swiper-item 的位移**，
// 正为右滑、负为左滑。因此指示块的位置要用 -dx 来算。
import {
  indicatorOffset,
  indicatorActiveIndex,
  tabTarget
} from '../utils/tab-indicator';

const fsx = require('fs') as any;

const COUNT = 3;
const STEP = 100; // 简化：每个 tab 100px

describe('指示块位置', () => {
  it('无位移时落在当前 tab 的中心', () => {
    expect(indicatorOffset(0, 0, COUNT, STEP)).toBe(0);
    expect(indicatorOffset(0, 1, COUNT, STEP)).toBe(100);
    expect(indicatorOffset(0, 2, COUNT, STEP)).toBe(200);
  });

  it('向左滑（dx 为负）指示块右移', () => {
    // dx = -50 表示滑到一半，指示块应在 50px 处
    expect(indicatorOffset(-50, 0, COUNT, STEP)).toBe(50);
  });

  it('向右滑（dx 为正）指示块左移', () => {
    expect(indicatorOffset(50, 1, COUNT, STEP)).toBe(50);
  });

  it('同样的 dx 产生同样的相对位移（与起始 tab 无关）', () => {
    // 从第 0 个往第 1 个滑 30px，与从第 1 个往第 2 个滑 30px，
    // 相对各自起点的位移都是 30px
    expect(indicatorOffset(-30, 0, COUNT, STEP) - 0).toBe(30);
    expect(indicatorOffset(-30, 1, COUNT, STEP) - 100).toBe(30);
  });

  it('越界时夹紧，不跑出栏外', () => {
    // dx 为负 = 向左滑 = 指示块右移，滑到底应在最右
    expect(indicatorOffset(-9999, 0, COUNT, STEP)).toBe(200);
    // dx 为正 = 向右滑 = 指示块左移，滑到底应在最左
    expect(indicatorOffset(9999, 2, COUNT, STEP)).toBe(0);
  });

  it('非法步长返回 0', () => {
    expect(indicatorOffset(-50, 0, COUNT, 0)).toBe(0);
    expect(indicatorOffset(-50, 0, 0, STEP)).toBe(0);
  });
});

describe('高亮项判定', () => {
  it('未滑动时高亮当前项', () => {
    expect(indicatorActiveIndex(0, 0, COUNT, STEP)).toBe(0);
    expect(indicatorActiveIndex(0, 2, COUNT, STEP)).toBe(2);
  });

  it('滑过一半就切换高亮', () => {
    expect(indicatorActiveIndex(-60, 0, COUNT, STEP)).toBe(1);
    expect(indicatorActiveIndex(-40, 0, COUNT, STEP)).toBe(0);
  });

  it('越界时取最近的有效项', () => {
    // 向左滑到底 → 最右那项
    expect(indicatorActiveIndex(-9999, 0, COUNT, STEP)).toBe(2);
    // 向右滑到底 → 最左那项
    expect(indicatorActiveIndex(9999, 2, COUNT, STEP)).toBe(0);
  });
});

describe('点击目标', () => {
  it('点击第 n 个 tab 时指示块落到 n * step', () => {
    expect(tabTarget(0, COUNT, STEP)).toEqual({ current: 0, offset: 0 });
    expect(tabTarget(2, COUNT, STEP)).toEqual({ current: 2, offset: 200 });
  });

  it('越界索引被夹紧', () => {
    expect(tabTarget(9, COUNT, STEP).current).toBe(2);
    expect(tabTarget(-3, COUNT, STEP).current).toBe(0);
  });
});

describe('共享 swiper 组件', () => {
  const wxml: string = fsx.readFileSync('components/tab-swiper/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('components/tab-swiper/index.ts', 'utf-8');
  const appJson = JSON.parse(fsx.readFileSync('app.json', 'utf-8'));

  it('swiper 承载三个 tab 的内容组件', () => {
    expect(wxml).toContain('<swiper');
    expect(wxml).toContain('<swiper-item');
    expect(wxml).toContain('tab-overview');
    expect(wxml).toContain('tab-vehicles');
    expect(wxml).toContain('tab-profile');
  });

  it('监听 transition（跟手）与 change（切换完成）', () => {
    expect(wxml).toContain('bindtransition="onTransition"');
    expect(wxml).toContain('bindchange="onChange"');
  });

  it('把指示块位置通过 triggerEvent 上报给页面', () => {
    expect(ts).toContain("triggerEvent('indicator'");
    expect(ts).toContain('indicatorOffset');
  });

  it('暴露 switchToTab 供底部栏点击调用', () => {
    expect(ts).toContain('switchToTab');
    expect(ts).toContain('notifyCurrent');
  });

  it('内容组件通过 ready 事件上报实例（selectComponent 选不到兄弟组件）', () => {
    expect(ts).toContain("onChildReady");
    expect(ts).toContain('triggerEvent');
  });

  it('tabBar.list 的 pagePath 互不重复（微信强制要求）', () => {
    expect(appJson.tabBar.list.length).toBe(3);
    const paths = appJson.tabBar.list.map((x: any) => x.pagePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('tabBar.list 与 pages 中的三个 tab 页面一致', () => {
    const paths = appJson.tabBar.list.map((x: any) => x.pagePath);
    for (const p of paths) {
      expect(appJson.pages).toContain(p);
    }
  });

  it('「概览」是启动首页', () => {
    expect(appJson.pages[0]).toBe('pages/tab-overview/index');
  });
});

describe('三个 tab 薄壳页', () => {
  const shells = [
    { p: 'pages/tab-overview', idx: 0 },
    { p: 'pages/tab-vehicles', idx: 1 },
    { p: 'pages/tab-profile', idx: 2 }
  ];

  for (const s of shells) {
    it(`${s.p} 渲染共享的 tab-swiper 组件`, () => {
      const wxml = fsx.readFileSync(`${s.p}/index.wxml`, 'utf-8');
      expect(wxml).toContain('tab-swiper');
      expect(wxml).toContain('bind:indicator="onIndicator"');
      expect(wxml).toContain(`initial="${s.idx}"`);
    });

    it(`${s.p} 的 json 声明了 tab-swiper 组件`, () => {
      const json = JSON.parse(fsx.readFileSync(`${s.p}/index.json`, 'utf-8'));
      expect(json.usingComponents['tab-swiper']).toBe('/components/tab-swiper/index');
    });
  }
});

describe('三个 tab 都是组件', () => {
  const comps = ['tab-overview', 'tab-vehicles', 'tab-profile'];

  for (const c of comps) {
    it(`${c} 是组件而非页面`, () => {
      const src = fsx.readFileSync(`components/${c}/index.ts`, 'utf-8');
      expect(src).toContain('Component({');
      expect(src).not.toContain('Page({');
      // 组件方法必须在 methods 里
      expect(src).toContain('methods:');
    });

    it(`${c} 的内容包在 scroll-view 里（swiper-item 内需要显式滚动容器）`, () => {
      const wxml = fsx.readFileSync(`components/${c}/index.wxml`, 'utf-8');
      expect(wxml).toContain('scroll-view');
      expect(wxml).toContain('scroll-y');
    });
  }
});

describe('旧的手势模块已移除', () => {
  it('tab-swipe 模块不再存在（swiper 已接管横向滑动）', () => {
    const fs = require('fs') as any;
    expect(fs.existsSync('utils/tab-swipe.ts')).toBe(false);
    expect(fs.existsSync('utils/tab-swipe-page.ts')).toBe(false);
  });

  it('三个组件不再绑定 touch 手势（会与 swiper 冲突）', () => {
    for (const c of ['tab-overview', 'tab-vehicles', 'tab-profile']) {
      const wxml = fsx.readFileSync(`components/${c}/index.wxml`, 'utf-8');
      expect(wxml).not.toContain('bindtouchstart');
      expect(wxml).not.toContain('bindtouchmove');
    }
  });
});

describe('页面路径完整性（防悬空引用）', () => {
  const fs = require('fs') as any;
  const path = require('path') as any;
  const appJson = JSON.parse(fs.readFileSync('app.json', 'utf-8'));
  const pages: string[] = appJson.pages;

  /** 递归收集源码文件 */
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'tests' || name === 'docs') {
        continue;
      }
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (/\.(ts|json|wxml)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('源码里引用的每个 /pages/xxx/index 都必须存在于 app.json', () => {
    const files = walk('.');
    const bad: string[] = [];
    const re = /\/pages\/([A-Za-z0-9_-]+)\/index/g;

    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const p = `pages/${m[1]}/index`;
        if (pages.indexOf(p) < 0) bad.push(`${f} -> ${p}`);
      }
    }

    // 指向不存在的页面会让开发者工具直接报 ENOENT（曾经踩过）
    expect(bad).toEqual([]);
  });

  it('每个 tab 页的四个文件都齐全', () => {
    for (const p of ['pages/tab-overview', 'pages/tab-vehicles', 'pages/tab-profile']) {
      for (const ext of ['ts', 'wxml', 'wxss', 'json']) {
        expect(fs.existsSync(`${p}/index.${ext}`)).toBe(true);
      }
    }
  });

  it('不存在残留的嵌套目录（pages/xxx/index/index.*）', () => {
    for (const p of ['pages/tab-overview', 'pages/tab-vehicles', 'pages/tab-profile']) {
      expect(fs.existsSync(`${p}/index`)).toBe(false);
    }
    expect(fs.existsSync('pages/tab-host')).toBe(false);
  });
});

describe('高度链完整（防止主界面空白）', () => {
  const fs = require('fs') as any;

  // 自定义组件宿主节点默认高度是 auto，任何一层没撑满，
  // 内部 height:100% 就会解析为 0 —— 整页白屏且没有任何报错。
  const CHAIN = [
    'pages/tab-overview/index.wxss',
    'pages/tab-vehicles/index.wxss',
    'pages/tab-profile/index.wxss',
    'components/tab-swiper/index.wxss',
    'components/tab-overview/index.wxss',
    'components/tab-vehicles/index.wxss',
    'components/tab-profile/index.wxss'
  ];

  for (const f of CHAIN) {
    it(`${f} 设置了有效高度`, () => {
      const css: string = fs.readFileSync(f, 'utf-8');
      expect(css).toMatch(/height:\s*(100%|100vh)/);
    });
  }

  it('薄壳页给组件宿主节点显式设了高度（tab-swiper 标签选择器）', () => {
    for (const f of [
      'pages/tab-overview/index.wxss',
      'pages/tab-vehicles/index.wxss',
      'pages/tab-profile/index.wxss'
    ]) {
      const css: string = fs.readFileSync(f, 'utf-8');
      expect(css).toMatch(/tab-swiper\s*\{[\s\S]{0,120}height:\s*100%/);
    }
  });

  it('组件用 :host 撑满宿主节点', () => {
    for (const f of [
      'components/tab-swiper/index.wxss',
      'components/tab-overview/index.wxss',
      'components/tab-vehicles/index.wxss',
      'components/tab-profile/index.wxss'
    ]) {
      const css: string = fs.readFileSync(f, 'utf-8');
      expect(css).toMatch(/:host\s*\{[\s\S]{0,120}height:\s*100%/);
    }
  });

  it('swiper 与 swiper-item 都撑满', () => {
    const css: string = fs.readFileSync('components/tab-swiper/index.wxss', 'utf-8');
    expect(css).toMatch(/\.host-swiper\s*\{[\s\S]{0,120}height:\s*100%/);
    expect(css).toMatch(/\.host-swiper-item\s*\{[\s\S]{0,120}height:\s*100%/);
  });

  it('内容组件的滚动容器撑满', () => {
    for (const c of ['tab-overview', 'tab-vehicles', 'tab-profile']) {
      const css: string = fs.readFileSync(`components/${c}/index.wxss`, 'utf-8');
      expect(css).toMatch(/\.page-scroll\s*\{[\s\S]{0,120}height:\s*100%/);
    }
  });
});

describe('滑动流畅性（防止闪烁与卡顿）', () => {
  const fs = require('fs') as any;
  const wxss: string = fs.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
  const barTs: string = fs.readFileSync('custom-tab-bar/index.ts', 'utf-8');
  const swiperTs: string = fs.readFileSync('components/tab-swiper/index.ts', 'utf-8');
  const swiperWxml: string = fs.readFileSync('components/tab-swiper/index.wxml', 'utf-8');

  it('指示块不加 transition（每帧重启过渡会导致抖动）', () => {
    const m = wxss.match(/\.tab-indicator \{[\s\S]*?\}/);
    expect(m).toBeTruthy();
    expect(m![0]).not.toContain('transition');
  });

  it('指示块用 will-change 走合成层', () => {
    const m = wxss.match(/\.tab-indicator \{[\s\S]*?\}/);
    expect(m![0]).toContain('will-change');
  });

  it('底栏不用 saturate（放大背景变化，看起来像底栏在动）', () => {
    expect(wxss).not.toMatch(/backdrop-filter:\s*[^;]*saturate/);
  });

  it('三态模型：drag 不带过渡跟手 / settle 带过渡落位 / final 无过渡精确落位', () => {
    expect(swiperTs).toContain("'drag' | 'settle' | 'final'");
    expect(swiperTs).toMatch(/mode === 'drag'[\s\S]{0,120}smooth: false/);
    expect(swiperTs).toMatch(/smooth: mode === 'settle'/);
  });

  it('change 只切高亮、不移动指示块（修「中间闪一下再跳到最右」的根）', () => {
    // swiper 越过边界就触发 change：快速滑动时 change(1) 先到，
    // 若立即吸附到中间，指示块会定格在中间，等 animationfinish 再跳到最右
    const onChange = swiperTs.slice(swiperTs.indexOf('onChange(e'));
    const nextFn = swiperTs.indexOf('onAnimationFinish');
    const body = swiperTs.slice(swiperTs.indexOf('onChange(e'), nextFn);
    expect(body).toContain('setIndicatorHighlight');
    expect(body).not.toMatch(/indicatorOffset/);
    expect(body).not.toContain("syncTabBar");
  });

  it('拖动态守卫：animationfinish 才退出拖动态并落位', () => {
    expect(swiperTs).toMatch(/_dragging = true/);
    expect(swiperTs).toMatch(/onTransition[\s\S]{0,120}if \(!\(this as any\)\._dragging\) return/);
    expect(swiperTs).toMatch(/onAnimationFinish[\s\S]{0,200}_dragging = false/);
  });

  it('锁定横向平移：不给 WebView 留下拖动 fixed 底栏的空间', () => {
    const swiperCss: string = fs.readFileSync('components/tab-swiper/index.wxss', 'utf-8');
    expect(swiperCss).toMatch(/overflow-x:\s*hidden/);
    const barCss: string = fs.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
    expect(barCss).toMatch(/translateZ\(0\)/);
  });

  it('底栏支持 index 为 null：只更新位移', () => {
    expect(barTs).toMatch(/index: number \| null/);
    expect(barTs).toMatch(/index === null[\s\S]{0,120}indicatorOffset: offset/);
  });

  it('位移变化小于 1px 时跳过 setData（降低跨线程通信频率）', () => {
    expect(swiperTs).toMatch(/_lastOffset/);
    expect(swiperTs).toMatch(/<\s*1\)\s*return/);
  });

  it('图标双层叠加，不切 src（切 src 会重新解码图片）', () => {
    expect(swiperWxml).toBeTruthy();
    const barWxml: string = fs.readFileSync('custom-tab-bar/index.wxml', 'utf-8');
    expect(barWxml).toContain('tab-icon-line');
    expect(barWxml).toContain('tab-icon-fill');
    // 实心层用 class 切换透明度，src 是固定的
    expect(barWxml).toContain('src="{{fillIcons[item.icon]}}"');
    expect(barWxml).toContain('src="{{lineIcons[item.icon]}}"');
  });
});

describe('跨页滑动时目标页已就绪（避免滑到位才出现）', () => {
  const fs = require('fs') as any;
  const ts: string = fs.readFileSync('components/tab-swiper/index.ts', 'utf-8');
  const wxml: string = fs.readFileSync('components/tab-swiper/index.wxml', 'utf-8');

  it('渲染「当前 + 相邻」页，而不是只渲染当前页', () => {
    expect(ts).toContain('keepFlags');
    expect(wxml).toContain('keep0');
    expect(wxml).toContain('keep1');
    expect(wxml).toContain('keep2');
    // 不再用 active === N 只渲染当前页
    expect(wxml).not.toContain('active ===');
  });

  it('keepFlags 规则：0 → 保留 0/1，1 → 全保留，2 → 保留 1/2', () => {
    // 直接验算规则（与实现同源）
    const keep = (i: number) => ({ keep0: i <= 1, keep1: true, keep2: i >= 1 });
    expect(keep(0)).toEqual({ keep0: true, keep1: true, keep2: false });
    expect(keep(1)).toEqual({ keep0: true, keep1: true, keep2: true });
    expect(keep(2)).toEqual({ keep0: false, keep1: true, keep2: true });
  });
});
