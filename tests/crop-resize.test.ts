// 裁剪页视口尺寸变化（转屏 / 分屏 / 折叠屏 / 键盘弹出）
//
// 背景：原来只在图片加载后量一次视口，之后一直用它换算裁剪区域。
// 视口一变 viewportSize 就与实际不符，computeSourceRect 算出的取样矩形会整体偏移——
// 用户看到的取景与裁出来的图不一致，且肉眼很难察觉。
import {
  CropState,
  MIN_ZOOM,
  MAX_ZOOM,
  computeDisplay,
  computeSourceRect,
  clampOffset,
  resizeViewport
} from '../utils/image-crop';

const fs = require('fs') as any;

/** 横图 */
const WIDE = { width: 4000, height: 3000 };
/** 竖图 */
const TALL = { width: 3000, height: 4000 };

/** 居中铺满（zoom=1）的初始状态 */
function centered(src: { width: number; height: number }, vp: number): CropState {
  const disp = computeDisplay(src, vp, MIN_ZOOM);
  return {
    zoom: MIN_ZOOM,
    offsetX: (vp - disp.displayW) / 2,
    offsetY: (vp - disp.displayH) / 2
  };
}

/** 取景中心落在源图上的相对位置（0~1），用于判断画面有没有跳 */
function centerRatio(
  state: CropState,
  src: { width: number; height: number },
  vp: number
): { cx: number; cy: number } {
  const r = computeSourceRect(state, src, vp);
  return { cx: (r.sx + r.sw / 2) / src.width, cy: (r.sy + r.sh / 2) / src.height };
}

describe('resizeViewport：视口变化后取景不跳', () => {
  it('视口变大：画面中心仍指向源图同一位置', () => {
    const before = centered(WIDE, 300);
    const c1 = centerRatio(before, WIDE, 300);

    const after = resizeViewport(before, WIDE, 300, 420);
    const c2 = centerRatio(after, WIDE, 420);

    expect(c2.cx).toBeCloseTo(c1.cx, 3);
    expect(c2.cy).toBeCloseTo(c1.cy, 3);
  });

  it('视口变小：画面中心仍指向源图同一位置', () => {
    const before = centered(TALL, 400);
    const c1 = centerRatio(before, TALL, 400);

    const after = resizeViewport(before, TALL, 400, 260);
    const c2 = centerRatio(after, TALL, 260);

    expect(c2.cx).toBeCloseTo(c1.cx, 3);
    expect(c2.cy).toBeCloseTo(c1.cy, 3);
  });

  it('缩放比例在视口变化时保持不变', () => {
    const before = { ...centered(WIDE, 300), zoom: 2.5 };
    const after = resizeViewport(before, WIDE, 300, 500);
    expect(after.zoom).toBe(2.5);
  });

  it('视口变化后仍然铺满，不出现白边', () => {
    for (const vp of [200, 320, 480, 640]) {
      for (const zoom of [MIN_ZOOM, 1.5, MAX_ZOOM]) {
        const before = { ...centered(WIDE, 300), zoom };
        const after = resizeViewport(before, WIDE, 300, vp);
        const disp = computeDisplay(WIDE, vp, after.zoom);
        // 图片必须完全覆盖视口
        expect(disp.displayW).toBeGreaterThanOrEqual(vp - 0.001);
        expect(disp.displayH).toBeGreaterThanOrEqual(vp - 0.001);
        expect(after.offsetX).toBeLessThanOrEqual(0.001);
        expect(after.offsetY).toBeLessThanOrEqual(0.001);
        expect(after.offsetX + disp.displayW).toBeGreaterThanOrEqual(vp - 0.001);
        expect(after.offsetY + disp.displayH).toBeGreaterThanOrEqual(vp - 0.001);
      }
    }
  });

  it('旧 state 越界时也能夹回合法区间（不会继承非法偏移）', () => {
    const illegal: CropState = { zoom: MIN_ZOOM, offsetX: -9999, offsetY: 9999 };
    const after = resizeViewport(illegal, WIDE, 300, 360);
    const safe = clampOffset(illegal, WIDE, 360);
    expect(after).toEqual(safe);
  });

  it('视口相同则状态不变（幂等）', () => {
    const before = centered(WIDE, 320);
    const after = resizeViewport(before, WIDE, 320, 320);
    expect(after.offsetX).toBeCloseTo(before.offsetX, 5);
    expect(after.offsetY).toBeCloseTo(before.offsetY, 5);
    expect(after.zoom).toBe(before.zoom);
  });

  it('横图竖图都成立', () => {
    for (const src of [WIDE, TALL]) {
      const before = centered(src, 300);
      const c1 = centerRatio(before, src, 300);
      const after = resizeViewport(before, src, 300, 450);
      const c2 = centerRatio(after, src, 450);
      expect(c2.cx).toBeCloseTo(c1.cx, 3);
      expect(c2.cy).toBeCloseTo(c1.cy, 3);
    }
  });

  it('非法输入安全降级', () => {
    const s: CropState = { zoom: 1, offsetX: 0, offsetY: 0 };
    expect(resizeViewport(s, { width: 0, height: 0 }, 300, 400)).toEqual({
      zoom: MIN_ZOOM,
      offsetX: 0,
      offsetY: 0
    });
    expect(resizeViewport(s, WIDE, 300, 0)).toEqual({
      zoom: MIN_ZOOM,
      offsetX: 0,
      offsetY: 0
    });
  });
});

describe('页面接上了尺寸变化监听', () => {
  const ts: string = fs.readFileSync('pages/icon-crop/index.ts', 'utf-8');

  it('监听并解绑窗口尺寸变化', () => {
    expect(ts).toContain('wx.onWindowResize');
    expect(ts).toContain('wx.offWindowResize');
    expect(ts).toMatch(/onUnload\(\)[\s\S]{0,200}offWindowResize/);
  });

  it('尺寸变化时以实测视口为准，并用 resizeViewport 迁移取景', () => {
    expect(ts).toContain('resizeViewport');
    expect(ts).toMatch(/handleResize\([\s\S]{0,600}boundingClientRect/);
  });

  it('尺寸变化在首次测量之后才开始监听（避免未就绪时误触发）', () => {
    const init = ts.indexOf('initViewport()');
    const watch = ts.indexOf('watchResize()');
    expect(init).toBeGreaterThan(0);
    expect(watch).toBeGreaterThan(init);
  });
});
