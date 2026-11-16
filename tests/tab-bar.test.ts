// 自定义底部栏：悬浮胶囊形态 + 手绘 SVG 图标（不用 emoji）
//
// 背景：原实现用 emoji（📊 🚙 👤）当图标。emoji 是彩色字形，无法换色、
// 无法做线性/实心双态，基线在不同机型上也不一致——这才是「图标粗糙」的根源。
// 改用 base64 data URI 的 SVG（小程序 WXML 不支持内联 <svg>）。
import { TAB_ICONS_LINE, TAB_ICONS_FILL } from '../utils/tab-icons';

const fsx = require('fs') as any;
// 项目未引入 @types/node，这里用 require 拿 Buffer
const BufferCtor: any = require('buffer').Buffer;

/** 解 base64 data URI 还原成 SVG 文本 */
function decode(uri: string): string {
  return BufferCtor.from(uri.split(',')[1], 'base64').toString('utf-8');
}

const wxml: string = fsx.readFileSync('custom-tab-bar/index.wxml', 'utf-8');
const wxss: string = fsx.readFileSync('custom-tab-bar/index.wxss', 'utf-8');
const ts: string = fsx.readFileSync('custom-tab-bar/index.ts', 'utf-8');

describe('图标：手绘 SVG 而非 emoji', () => {
  it('三个图标都有描边态与实心态', () => {
    for (const key of ['overview', 'car', 'user']) {
      expect(TAB_ICONS_LINE[key]).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(TAB_ICONS_FILL[key]).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  it('两态是不同内容（选中态确实换图）', () => {
    for (const key of ['overview', 'car', 'user']) {
      expect(TAB_ICONS_LINE[key]).not.toBe(TAB_ICONS_FILL[key]);
    }
  });

  it('data URI 能解回合法 SVG', () => {
    for (const key of ['overview', 'car', 'user']) {
      const svg = decode(TAB_ICONS_LINE[key]);
      expect(svg).toContain('<svg');
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('</svg>');
    }
  });

  it('描边态用灰色、实心态用品牌蓝', () => {
    expect(decode(TAB_ICONS_LINE.car)).toContain('#6B7486');
    expect(decode(TAB_ICONS_FILL.car)).toContain('#3B6FF6');
  });

  it('底栏不再残留 emoji 图标', () => {
    for (const emoji of ['📊', '🚙', '👤']) {
      expect(ts).not.toContain(emoji);
    }
    expect(wxml).not.toContain('{{item.icon}}');
  });

  it('体积可控（图标模块 < 8KB）', () => {
    const size = fsx.statSync('utils/tab-icons.ts').size;
    expect(size).toBeLessThan(8 * 1024);
  });
});

describe('组件：按选中态切换图标', () => {
  it('WXML 用 image 渲染，高亮由 indicatorIndex 决定', () => {
    expect(wxml).toContain('<image');
    // 高亮项由指示块的位置决定（滑动时连续变化），不再是固定的 selected
    expect(wxml).toContain(
      'indicatorIndex === index ? fillIcons[item.icon] : lineIcons[item.icon]'
    );
    expect(wxml).toContain('mode="aspectFit"');
  });

  it('图标表经 data 传入（WXML 不能直接引用 import 的常量）', () => {
    expect(ts).toContain('lineIcons: TAB_ICONS_LINE');
    expect(ts).toContain('fillIcons: TAB_ICONS_FILL');
  });

  it('三个 tab 的图标键与图标表对得上', () => {
    const re = /icon: '(\w+)'/g;
    const keys: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(ts)) !== null) {
      keys.push(m[1]);
    }
    expect(keys).toEqual(['overview', 'car', 'user']);
    for (const k of keys) {
      expect(TAB_ICONS_LINE[k]).toBeTruthy();
      expect(TAB_ICONS_FILL[k]).toBeTruthy();
    }
  });
});

describe('形态：悬浮胶囊 + 毛玻璃', () => {
  it('脱离屏幕底部、圆角胶囊', () => {
    expect(wxss).toMatch(/\.tab-bar \{[\s\S]{0,400}left:\s*28rpx/);
    expect(wxss).toMatch(/\.tab-bar \{[\s\S]{0,400}right:\s*28rpx/);
    // border-radius 在样式块较靠后，窗口放宽
    expect(wxss).toMatch(/\.tab-bar \{[\s\S]{0,900}border-radius:\s*999rpx/);
  });

  it('毛玻璃：backdrop-filter + 半透明底', () => {
    expect(wxss).toContain('backdrop-filter');
    expect(wxss).toMatch(/background:\s*rgba\(255,\s*255,\s*255,\s*0\.\d+\)/);
  });

  it('有玻璃厚度感的高光描边与投影', () => {
    expect(wxss).toContain('border:');
    expect(wxss).toContain('box-shadow:');
  });

  it('底部偏移考虑安全区', () => {
    expect(wxss).toContain('env(safe-area-inset-bottom)');
  });

  it('指示块是独立的绝对定位元素（不推动图标布局）', () => {
    expect(wxss).toMatch(/\.tab-indicator \{[\s\S]{0,200}position:\s*absolute/);
    expect(wxml).toContain('class="tab-indicator"');
  });

  it('指示块用 transform 横向位移（跟手）', () => {
    expect(wxml).toContain('transform: translateX({{indicatorOffset}}px)');
  });

  it('指示块底色是半透明淡蓝（不是实心蓝块）', () => {
    const m = wxss.match(/\.tab-indicator \{[\s\S]{0,400}?background:\s*([^;]+);/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('rgba');
    expect(m![1]).toContain('0.1');
  });

  it('高亮文字与图标用独立类，胶囊本身不移动', () => {
    expect(wxss).toMatch(/\.tab-text-on \{[\s\S]{0,120}#3B6FF6/);
    // 胶囊不参与位移：位移只在指示块上
    expect(wxss).not.toMatch(/\.tab-bar \{[\s\S]{0,900}transform:/);
  });
});

describe('页面底部留白与悬浮胶囊匹配', () => {
  const pages = [
    'components/tab-overview/index.wxss',
    'components/tab-vehicles/index.wxss',
    'components/tab-profile/index.wxss'
  ];

  for (const p of pages) {
    it(`${p} 预留了胶囊高度 + 安全区`, () => {
      const css: string = fsx.readFileSync(p, 'utf-8');
      const m = css.match(/padding-bottom:\s*([^;]+);/);
      expect(m).toBeTruthy();
      const v = m![1];
      // 必须含安全区，且留白要大于胶囊自身高度 108rpx
      expect(v).toContain('env(safe-area-inset-bottom)');
      // calc(...) 开头，parseInt 会得到 NaN，改用正则取数字
      const numMatch = v.match(/(\d+)rpx/);
      expect(numMatch).toBeTruthy();
      expect(parseInt(numMatch![1], 10)).toBeGreaterThan(108);
    });
  }
});
