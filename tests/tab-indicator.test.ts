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

describe('宿主页结构', () => {
  const wxml: string = fsx.readFileSync('pages/tab-host/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('pages/tab-host/index.ts', 'utf-8');
  const appJson = JSON.parse(fsx.readFileSync('app.json', 'utf-8'));

  it('宿主页用 swiper 承载三个 tab', () => {
    expect(wxml).toContain('<swiper');
    expect(wxml).toContain('<swiper-item');
    expect(wxml).toContain('tab-overview');
    expect(wxml).toContain('tab-vehicles');
    expect(wxml).toContain('tab-profile');
  });

  it('监听 transition（跟手）与 change（切换完成）', () => {
    expect(wxml).toContain('bindtransition="onSwiperTransition"');
    expect(wxml).toContain('bindchange="onSwiperChange"');
  });

  it('把指示块位置传给底部栏', () => {
    expect(ts).toContain('setIndicatorOffset');
    expect(ts).toContain('indicatorOffset');
  });

  it('暴露 switchToTab 供底部栏点击调用', () => {
    expect(ts).toContain('switchToTab');
  });

  it('tabBar.list 三个项都指向宿主页', () => {
    expect(appJson.tabBar.list.length).toBe(3);
    for (const item of appJson.tabBar.list) {
      expect(item.pagePath).toBe('pages/tab-host/index');
    }
  });

  it('宿主页是启动首页', () => {
    expect(appJson.pages[0]).toBe('pages/tab-host/index');
  });

  it('宿主页通过 onShown 通知组件刷新（组件没有 onShow）', () => {
    expect(ts).toContain('notifyShown');
    expect(ts).toContain('onShown');
  });
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
