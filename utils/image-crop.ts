// 图标裁剪几何计算（纯函数，不依赖 wx）
//
// 模型：正方形视口 size × size；图片以「覆盖视口」的基准缩放铺满，
// 再乘用户倍率 zoom（>=1），用 offsetX/offsetY 表示图片左上角相对视口左上角的位移。
//
// 不变式（任一被破坏就会出现白边）：
//   offsetX ∈ [size - displayW, 0]
//   offsetY ∈ [size - displayH, 0]
//   displayW >= size 且 displayH >= size
//
// 抽成纯函数的理由：裁剪错位在真机上才看得出来，靠肉眼测太慢；
// 这里可以穷举极端尺寸（超宽全景、超长竖图、小图放大）验证不变式。

/** 裁剪结果边长（px）。图标渲染只有 20~30px，256 已足够 2 倍屏以上 */
export const CROP_OUTPUT_SIZE = 256;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export interface CropSource {
  width: number;
  height: number;
}

export interface CropState {
  /** 用户倍率，>= 1 */
  zoom: number;
  /** 图片左上角相对视口左上角的位移，<= 0 */
  offsetX: number;
  offsetY: number;
}

export interface CropDisplay {
  /** 覆盖视口所需的基准缩放 */
  baseScale: number;
  displayW: number;
  displayH: number;
}

export interface CropSourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

function isValidSource(src: CropSource): boolean {
  return (
    !!src &&
    isFinite(src.width) &&
    isFinite(src.height) &&
    src.width > 0 &&
    src.height > 0
  );
}

/** 覆盖视口所需的最小缩放：取宽高两个方向中较大的那个，保证铺满不留白 */
export function coverBaseScale(src: CropSource, viewportSize: number): number {
  if (!isValidSource(src) || !(viewportSize > 0)) return 0;
  return Math.max(viewportSize / src.width, viewportSize / src.height);
}

export function clampZoom(zoom: number): number {
  if (!isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 图片在屏幕上的实际显示尺寸 */
export function computeDisplay(
  src: CropSource,
  viewportSize: number,
  zoom: number
): CropDisplay {
  if (!isValidSource(src) || !(viewportSize > 0)) {
    return { baseScale: 0, displayW: 0, displayH: 0 };
  }
  const baseScale = coverBaseScale(src, viewportSize);
  const z = clampZoom(zoom);
  return {
    baseScale,
    displayW: src.width * baseScale * z,
    displayH: src.height * baseScale * z
  };
}

/** 把位移夹回合法区间，避免拖出白边 */
export function clampOffset(
  state: CropState,
  src: CropSource,
  viewportSize: number
): CropState {
  const zoom = clampZoom(state.zoom);
  const { displayW, displayH } = computeDisplay(src, viewportSize, zoom);
  if (!(displayW > 0) || !(displayH > 0)) {
    return { zoom, offsetX: 0, offsetY: 0 };
  }

  const minX = viewportSize - displayW; // <= 0
  const minY = viewportSize - displayH;
  const clampAxis = (v: number, min: number) => {
    if (!isFinite(v)) return min;
    return Math.min(0, Math.max(min, v));
  };

  return {
    zoom,
    offsetX: clampAxis(state.offsetX, minX),
    offsetY: clampAxis(state.offsetY, minY)
  };
}

/**
 * 把「视口内可见区域」换算成源图上的取样矩形。
 * 结果用于 ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out, out)。
 */
export function computeSourceRect(
  state: CropState,
  src: CropSource,
  viewportSize: number
): CropSourceRect {
  const safe = clampOffset(state, src, viewportSize);
  const { displayW } = computeDisplay(src, viewportSize, safe.zoom);

  if (!(displayW > 0)) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  // 屏幕像素 → 源图像素的换算比例
  const ratio = src.width / displayW;

  return {
    sx: -safe.offsetX * ratio,
    sy: -safe.offsetY * ratio,
    sw: viewportSize * ratio,
    sh: viewportSize * ratio
  };
}

/**
 * 以视口中心为基准缩放（双指捏合时，画面不应往左上角跑）。
 * 传入缩放前的 state 与新 zoom，返回缩放后仍然合法的 state。
 */
export function zoomAroundCenter(
  state: CropState,
  src: CropSource,
  viewportSize: number,
  nextZoom: number
): CropState {
  const prev = clampOffset(state, src, viewportSize);
  const z = clampZoom(nextZoom);
  const k = z / prev.zoom;

  // 缩放中心在图片坐标系中的位置应保持不动
  const cx = (viewportSize / 2 - prev.offsetX) * k;
  const cy = (viewportSize / 2 - prev.offsetY) * k;

  return clampOffset(
    {
      zoom: z,
      offsetX: viewportSize / 2 - cx,
      offsetY: viewportSize / 2 - cy
    },
    src,
    viewportSize
  );
}

/**
 * 视口尺寸变化时，把取景迁移到新的视口。
 *
 * 用途：转屏、分屏、折叠屏展开、键盘弹出都会改变裁剪视口的像素边长。
 * 若沿用旧 state 直接配新视口，取景会整体偏移——用户看到的和裁出来的不一致。
 *
 * 做法：先按**新视口**把位移夹回合法区间。缩放保持不变，
 * 偏移量按视口中心等比调整，画面不会跳动，只是把同一块内容框进新尺寸。
 */
export function resizeViewport(
  state: CropState,
  src: CropSource,
  prevViewportSize: number,
  nextViewportSize: number
): CropState {
  if (!isValidSource(src) || !(nextViewportSize > 0)) {
    return { zoom: MIN_ZOOM, offsetX: 0, offsetY: 0 };
  }
  const zoom = clampZoom(state.zoom);
  const prev = prevViewportSize > 0 ? prevViewportSize : nextViewportSize;

  // 取景中心在「图片坐标系」中的位置（相对旧视口）
  const prevDisp = computeDisplay(src, prev, zoom);
  const nextDisp = computeDisplay(src, nextViewportSize, zoom);
  if (!(prevDisp.displayW > 0) || !(nextDisp.displayW > 0)) {
    return clampOffset({ zoom, offsetX: 0, offsetY: 0 }, src, nextViewportSize);
  }

  // 旧视口中心对应的图片内坐标（从图片左上角算起的像素）
  const centerInImageX = (prev / 2 - state.offsetX) / prevDisp.displayW;
  const centerInImageY = (prev / 2 - state.offsetY) / prevDisp.displayH;

  // 让新视口中心仍然对准同一处图片内容
  return clampOffset(
    {
      zoom,
      offsetX: nextViewportSize / 2 - centerInImageX * nextDisp.displayW,
      offsetY: nextViewportSize / 2 - centerInImageY * nextDisp.displayH
    },
    src,
    nextViewportSize
  );
}

/** 是否可用（用于页面在拿到图片尺寸后判断要不要显示裁剪界面） */
export function isCroppable(src: CropSource): boolean {
  return isValidSource(src);
}
