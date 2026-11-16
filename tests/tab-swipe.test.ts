// 底部栏随页面横向滑动而滑动（iOS Tab Bar 观感）
//
// 交互：三个 tab 页可左右滑动切换，滑动过程中底部胶囊跟着手指横向位移，
// 松手后落位或回弹。
import {
  SwipeState,
  computeProgress,
  resolveTarget,
  stepPx,
  capsuleOffset,
  SWIPE_THRESHOLD_PX,
  AXIS_RATIO,
  TAB_MARGIN_RPX
} from '../utils/tab-swipe';

const fsx = require('fs') as any;

const VP = { windowWidth: 375, windowHeight: 667 };
const COUNT = 3;

function swipe(deltaX: number, horizontal = true): SwipeState {
  return { startX: 200, startY: 300, horizontal, deltaX };
}

describe('步长计算', () => {
  it('步长为胶囊内可用宽 / tab 数', () => {
    const rpx = VP.windowWidth / 750;
    const capsule = VP.windowWidth - TAB_MARGIN_RPX * 2 * rpx;
    const inner = capsule - 16 * rpx;
    expect(stepPx(VP, COUNT)).toBeCloseTo(inner / COUNT, 5);
  });

  it('窗口越宽步长越大', () => {
    expect(stepPx({ windowWidth: 414, windowHeight: 896 }, COUNT)).toBeGreaterThan(
      stepPx(VP, COUNT)
    );
  });

  it('非法输入返回 0', () => {
    expect(stepPx({ windowWidth: 0, windowHeight: 0 }, COUNT)).toBe(0);
    expect(stepPx(VP, 0)).toBe(0);
  });
});

describe('手势方向判定', () => {
  it('横向位移明显大于纵向才判定为横滑', () => {
    // 轴向比例阈值存在
    expect(AXIS_RATIO).toBeGreaterThan(1);
  });
});

describe('滑动进度', () => {
  it('未判定为横滑时进度不变', () => {
    expect(computeProgress(swipe(100, false), 1, VP, COUNT)).toBe(1);
  });

  it('向右滑（dx 为负）进度减小', () => {
    const p = computeProgress(swipe(-60), 1, VP, COUNT);
    expect(p).toBeLessThan(1);
  });

  it('向左滑（dx 为正）进度增大', () => {
    const p = computeProgress(swipe(60), 1, VP, COUNT);
    expect(p).toBeGreaterThan(1);
  });

  it('进度随位移线性变化', () => {
    const step = stepPx(VP, COUNT);
    const p1 = computeProgress(swipe(step), 0, VP, COUNT);
    const p2 = computeProgress(swipe(step * 2), 0, VP, COUNT);
    expect(p1).toBeCloseTo(1, 5);
    expect(p2).toBeCloseTo(2, 5);
  });

  it('越界时只允许小幅回弹，不跨到别的 tab', () => {
    const p = computeProgress(swipe(9999), 0, VP, COUNT);
    expect(p).toBeGreaterThanOrEqual(-0.35);
    expect(p).toBeLessThanOrEqual(COUNT - 1 + 0.35);
  });
});

describe('松手后的目标', () => {
  it('位移不足阈值则不切换', () => {
    const r = resolveTarget(swipe(SWIPE_THRESHOLD_PX - 5), 1, VP, COUNT);
    expect(r.switched).toBe(false);
    expect(r.target).toBe(1);
  });

  it('手指左滑（dx 为负）切到下一个 tab', () => {
    const r = resolveTarget(swipe(-100), 1, VP, COUNT);
    expect(r.switched).toBe(true);
    expect(r.target).toBe(2);
  });

  it('手指右滑（dx 为正）切到上一个 tab', () => {
    const r = resolveTarget(swipe(100), 1, VP, COUNT);
    expect(r.switched).toBe(true);
    expect(r.target).toBe(0);
  });

  it('在最左端继续右滑不越界', () => {
    const r = resolveTarget(swipe(100), 0, VP, COUNT);
    expect(r.switched).toBe(false);
    expect(r.target).toBe(0);
  });

  it('在最右端继续左滑不越界', () => {
    const r = resolveTarget(swipe(-100), COUNT - 1, VP, COUNT);
    expect(r.switched).toBe(false);
    expect(r.target).toBe(COUNT - 1);
  });

  it('未判定为横滑不切换', () => {
    const r = resolveTarget(swipe(300, false), 1, VP, COUNT);
    expect(r.switched).toBe(false);
  });
});

describe('胶囊位移与回弹阻尼', () => {
  it('进度等于当前索引时位移为 0', () => {
    expect(capsuleOffset(1, 1, VP, COUNT)).toBeCloseTo(0, 5);
  });

  it('位移有上限：正常跟手不超过 0.75 步长，回弹最多到 1.15 倍', () => {
    const step = stepPx(VP, COUNT);
    // 轻微拖动：线性跟手，不超过 0.75 步长
    const light = capsuleOffset(1 + 0.3, 1, VP, COUNT);
    expect(Math.abs(light)).toBeLessThanOrEqual(step * 0.75 + 0.001);

    // 过度拖动：阻尼后封顶在 1.15 倍，不会无限拉长
    const heavy = capsuleOffset(1 + 3, 1, VP, COUNT);
    expect(Math.abs(heavy)).toBeLessThanOrEqual(step * 0.75 * 1.15 + 0.001);
    expect(Math.abs(heavy)).toBeGreaterThan(step * 0.75);
  });

  it('超出部分有阻尼（增长变缓）', () => {
    const step = stepPx(VP, COUNT);
    const a = capsuleOffset(1 + 1, 1, VP, COUNT);
    const b = capsuleOffset(1 + 2, 1, VP, COUNT);
    // 越往后每单位进度带来的位移越小
    expect(Math.abs(b - a)).toBeLessThan(Math.abs(a));
  });

  it('左右对称', () => {
    const l = capsuleOffset(1 - 0.4, 1, VP, COUNT);
    const r = capsuleOffset(1 + 0.4, 1, VP, COUNT);
    expect(l).toBeCloseTo(-r, 5);
  });
});

describe('三个 tab 页都接上了手势', () => {
  const pages = [
    { wxml: 'pages/reminder/index.wxml', ts: 'pages/reminder/index.ts', index: 0 },
    { wxml: 'pages/index/index.wxml', ts: 'pages/index/index.ts', index: 1 },
    { wxml: 'pages/user/index.wxml', ts: 'pages/user/index.ts', index: 2 }
  ];

  for (const p of pages) {
    it(`${p.wxml} 绑定四个触摸事件`, () => {
      const src: string = fsx.readFileSync(p.wxml, 'utf-8');
      expect(src).toContain('bindtouchstart="onTouchStart"');
      expect(src).toContain('bindtouchmove="onTouchMove"');
      expect(src).toContain('bindtouchend="onTouchEnd"');
      expect(src).toContain('bindtouchcancel="onTouchCancel"');
    });

    it(`${p.ts} 挂载手势处理器且索引为 ${p.index}`, () => {
      const src: string = fsx.readFileSync(p.ts, 'utf-8');
      expect(src).toContain('createTabSwipeHandlers');
      expect(src).toContain(`index: ${p.index}, count: 3`);
    });
  }
});

describe('组件支持滑动位移', () => {
  const wxml: string = fsx.readFileSync('custom-tab-bar/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('custom-tab-bar/index.ts', 'utf-8');

  it('胶囊用 transform 横向位移', () => {
    expect(wxml).toContain('transform: translateX({{offsetX}}px)');
  });

  it('提供 setSwipeOffset 与 endSwipe 方法', () => {
    expect(ts).toContain('setSwipeOffset');
    expect(ts).toContain('endSwipe');
  });

  it('滑动中不高亮，避免和位移不同步', () => {
    expect(wxml).toContain('!dragging');
  });

  it('onShow 时复位位移（从别处滑回来不应停在半路）', () => {
    for (const p of ['pages/reminder/index.ts', 'pages/index/index.ts', 'pages/user/index.ts']) {
      const src: string = fsx.readFileSync(p, 'utf-8');
      expect(src).toContain('offsetX: 0');
      expect(src).toContain('dragging: false');
    }
  });
});
