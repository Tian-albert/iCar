// 图标裁剪页：把任意尺寸的图片裁成 1:1 正方形图标
//
// 为什么单独开页而不是做成组件弹层：
// 裁剪要 canvas 节点 + 手势 + 独立的页面高度，塞进底部弹层会被弹层高度压扁，
// 手势也容易和弹层的滚动冲突。
//
// 结果回传：wx.navigateTo 时注册 events，裁剪完 emit('cropped', path) 后返回。
import {
  CROP_OUTPUT_SIZE,
  CropState,
  MIN_ZOOM,
  MAX_ZOOM,
  clampOffset,
  clampZoom,
  computeDisplay,
  computeSourceRect,
  isCroppable,
  resizeViewport,
  zoomAroundCenter
} from '../../utils/image-crop';
import { COMPONENT_ACTIVE_COLOR } from '../../utils/tokens';

Page({
  data: {
    activeColor: COMPONENT_ACTIVE_COLOR,
    src: '',
    /** 裁剪视口的实际像素边长，由 boundingClientRect 测得 */
    viewportSize: 0,
    displayW: 0,
    displayH: 0,
    offsetX: 0,
    offsetY: 0,
    /** 用户倍率，>= 1 */
    zoom: MIN_ZOOM,
    /** 供滑杆显示：0~100 */
    zoomPercent: 0,
    loading: true,
    failed: false,
    confirming: false
  },

  onLoad(options: Record<string, string>) {
    // decodeURIComponent 在路径含非法 % 序列时会抛错；不兜住的话页面
    // 会卡在「加载中…」，连失败提示都出不来
    let src = '';
    try {
      src = decodeURIComponent(options.src || '');
    } catch (e) {
      src = options.src || '';
    }
    if (!src) {
      this.setData({ loading: false, failed: true });
      return;
    }
    this.setData({ src });

    wx.getImageInfo({
      src,
      success: res => {
        (this as any)._natural = { width: res.width, height: res.height };
        this.initViewport();
      },
      fail: () => this.setData({ loading: false, failed: true })
    });
  },

  /** 量出视口像素尺寸后，把图片居中铺满（zoom=1） */
  initViewport() {
    this.createSelectorQuery()
      .select('#cropView')
      .boundingClientRect((rect: any) => {
        const natural = (this as any)._natural;
        const vp = rect && rect.width;
        if (!isCroppable(natural) || !(vp > 0)) {
          this.setData({ loading: false, failed: true });
          return;
        }
        const disp = computeDisplay(natural, vp, MIN_ZOOM);
        this.setData({
          viewportSize: vp,
          displayW: disp.displayW,
          displayH: disp.displayH,
          offsetX: (vp - disp.displayW) / 2,
          offsetY: (vp - disp.displayH) / 2,
          zoomPercent: 0,
          loading: false
        });
        this.watchResize();
      })
      .exec();
  },

  /**
   * 监听视口尺寸变化（转屏 / 分屏 / 折叠屏展开 / 键盘弹出）。
   *
   * 原来只在图片加载后量一次视口，之后一直用这个值换算裁剪区域。
   * 视口一变，viewportSize 就与实际不符，computeSourceRect 算出的取样矩形
   * 会整体偏移——用户看到的取景与裁出来的图不一致，且**肉眼很难察觉**。
   */
  watchResize() {
    if (typeof wx === 'undefined' || !wx.onWindowResize) return;
    (this as any)._onResize = (res: any) => this.handleResize(res);
    wx.onWindowResize((this as any)._onResize);
  },

  handleResize(res: any) {
    const natural = (this as any)._natural;
    if (!isCroppable(natural) || this.data.loading || this.data.failed) return;

    // 先按窗口宽度推算视口边长，再以实际测量为准（异步，避免连续 resize 抖动）
    this.createSelectorQuery()
      .select('#cropView')
      .boundingClientRect((rect: any) => {
        const vp = rect && rect.width;
        const prev = this.data.viewportSize;
        if (!(vp > 0) || Math.abs(vp - prev) < 0.5) return;

        const next = resizeViewport(this.currentState(), natural, prev, vp);
        const disp = computeDisplay(natural, vp, next.zoom);
        this.setData({
          viewportSize: vp,
          displayW: disp.displayW,
          displayH: disp.displayH,
          offsetX: next.offsetX,
          offsetY: next.offsetY,
          zoom: next.zoom,
          zoomPercent: Math.round(((next.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100)
        });
        // res 仅用于触发时机，尺寸以实测为准
        void res;
      })
      .exec();
  },

  onUnload() {
    const handler = (this as any)._onResize;
    if (handler && typeof wx !== 'undefined' && wx.offWindowResize) {
      wx.offWindowResize(handler);
    }
    (this as any)._onResize = null;
  },

  /** 统一的落状态入口：先夹回合法区间再 setData，保证永远不出现白边 */
  applyState(state: CropState) {
    const natural = (this as any)._natural;
    const vp = this.data.viewportSize;
    if (!isCroppable(natural) || !(vp > 0)) return;

    const safe = clampOffset(state, natural, vp);
    const disp = computeDisplay(natural, vp, safe.zoom);
    this.setData({
      zoom: safe.zoom,
      offsetX: safe.offsetX,
      offsetY: safe.offsetY,
      displayW: disp.displayW,
      displayH: disp.displayH,
      zoomPercent: Math.round(((safe.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100)
    });
  },

  currentState(): CropState {
    return {
      zoom: this.data.zoom,
      offsetX: this.data.offsetX,
      offsetY: this.data.offsetY
    };
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    const t = e.touches;
    if (!t || !t.length) return;
    const start: any = {
      offsetX: this.data.offsetX,
      offsetY: this.data.offsetY,
      zoom: this.data.zoom,
      x: t[0].clientX,
      y: t[0].clientY,
      dist: 0
    };
    if (t.length >= 2) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      start.dist = Math.sqrt(dx * dx + dy * dy);
    }
    (this as any)._start = start;
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    const s = (this as any)._start;
    const t = e.touches;
    if (!s || !t || !t.length) return;

    // 双指捏合：以视口中心为锚点缩放，画面不会往左上角跑
    if (t.length >= 2 && s.dist > 0) {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        this.applyState(
          zoomAroundCenter(
            { zoom: s.zoom, offsetX: s.offsetX, offsetY: s.offsetY },
            (this as any)._natural,
            this.data.viewportSize,
            s.zoom * (dist / s.dist)
          )
        );
      }
      return;
    }

    // 单指拖动
    this.applyState({
      zoom: s.zoom,
      offsetX: s.offsetX + (t[0].clientX - s.x),
      offsetY: s.offsetY + (t[0].clientY - s.y)
    });
  },

  onTouchEnd(e: WechatMiniprogram.TouchEvent) {
    const t = e && e.touches;
    if (t && t.length === 1) {
      // 双指抬起一指、剩下单指继续拖：必须用剩余手指的位置重置起点，
      // 否则继续拖动时会按「捏合前的起点」算位移，画面瞬间跳一下。
      (this as any)._start = {
        offsetX: this.data.offsetX,
        offsetY: this.data.offsetY,
        zoom: this.data.zoom,
        x: t[0].clientX,
        y: t[0].clientY,
        dist: 0
      };
      return;
    }
    (this as any)._start = null;
  },

  /** 滑杆缩放：开发者工具里不便模拟双指，也照顾不便捏合的用户 */
  onZoomSlide(e: WechatMiniprogram.SliderChange) {
    const p = Number(e.detail.value) || 0;
    const next = MIN_ZOOM + ((MAX_ZOOM - MIN_ZOOM) * p) / 100;
    const natural = (this as any)._natural;
    if (!isCroppable(natural)) return;
    this.applyState(
      zoomAroundCenter(
        this.currentState(),
        natural,
        this.data.viewportSize,
        clampZoom(next)
      )
    );
  },

  onCancel() {
    wx.navigateBack();
  },

  /** 导出 256×256 PNG，存进沙盒后把路径回传给上一页 */
  onConfirm() {
    if (this.data.confirming) return;
    this.setData({ confirming: true });
    wx.showLoading({ title: '处理中', mask: true });

    this.exportCropped()
      .then(tempPath => {
        const saved = this.persistIcon(tempPath);
        wx.hideLoading();
        const ec = this.getOpenerEventChannel();
        if (ec && typeof (ec as any).emit === 'function') {
          (ec as any).emit('cropped', saved);
        }
        wx.navigateBack();
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ confirming: false });
        wx.showToast({ title: '裁剪失败，请重试', icon: 'none' });
      });
  },

  /**
   * 按当前取景导出正方形图片。
   * 注意 canvas.width/height 设成输出尺寸（不乘 dpr）——
   * 图标用途 256px 已足够，乘 dpr 只会让文件变大。
   */
  exportCropped(): Promise<string> {
    return new Promise((resolve, reject) => {
      // 超时兜底：exec / img.onload / canvasToTempFilePath 任一环节不回调时，
      // Promise 永不 settle，loading 遮罩（mask:true）会把整页锁死且无退出入口。
      let settled = false;
      let timer: any = null;
      const finish = (fn: (v: any) => void, v: any) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(v);
      };
      timer = setTimeout(() => finish(reject, new Error('export timeout')), 10000);

      this.createSelectorQuery()
        .select('#cropCanvas')
        .fields({ node: true, size: true })
        .exec((res: any) => {
          try {
            const canvas = res && res[0] && res[0].node;
            if (!canvas) {
              finish(reject, new Error('canvas not found'));
              return;
            }
            canvas.width = CROP_OUTPUT_SIZE;
            canvas.height = CROP_OUTPUT_SIZE;
            const ctx = canvas.getContext('2d');

            const img = canvas.createImage();
            img.onload = () => {
              try {
                const rect = computeSourceRect(
                  this.currentState(),
                  (this as any)._natural,
                  this.data.viewportSize
                );
                ctx.clearRect(0, 0, CROP_OUTPUT_SIZE, CROP_OUTPUT_SIZE);
                ctx.drawImage(
                  img,
                  rect.sx,
                  rect.sy,
                  rect.sw,
                  rect.sh,
                  0,
                  0,
                  CROP_OUTPUT_SIZE,
                  CROP_OUTPUT_SIZE
                );
                wx.canvasToTempFilePath({
                  canvas,
                  x: 0,
                  y: 0,
                  width: CROP_OUTPUT_SIZE,
                  height: CROP_OUTPUT_SIZE,
                  destWidth: CROP_OUTPUT_SIZE,
                  destHeight: CROP_OUTPUT_SIZE,
                  fileType: 'png',
                  success: r => finish(resolve, r.tempFilePath),
                  fail: () => finish(reject, new Error('export failed'))
                });
              } catch (err) {
                finish(reject, err);
              }
            };
            img.onerror = () => finish(reject, new Error('image load failed'));
            img.src = this.data.src;
          } catch (err) {
            finish(reject, err);
          }
        });
    });
  },

  /**
   * 把临时文件落到沙盒，避免重启后图标丢失。
   *
   * 失败时必须抛错而不是退回临时路径：临时文件重启后即失效，
   * 若继续返回该路径、还会被登记进图标库，就会留下一个永远打不开的图标。
   */
  persistIcon(tempPath: string): string {
    const dest = `${wx.env.USER_DATA_PATH}/icon-${Date.now()}.png`;
    wx.getFileSystemManager().copyFileSync(tempPath, dest);
    return dest;
  }
});
