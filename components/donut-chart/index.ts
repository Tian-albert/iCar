// 分类支出环形图：外标签引线 + 点击放大 + 气泡 + 中心金额
// 绘制算法已抽到 utils/chart-render.ts，与统计页分享卡片共用同一份实现。
import { hitDonutSegment, toCanvasPoint } from '../../utils/chart-math';
import { renderDonut, computeDonutLayout } from '../../utils/chart-render';

interface Segment {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

Component({
  properties: {
    segments: { type: Array, value: [] as Segment[] },
    total: { type: String, value: '' },
    /**
     * 受控选中项：-1 表示未选中。
     *
     * 页面（统计页的分类图例）可以通过改它来驱动扇区突出；
     * 用户点扇区时组件用 `change` 事件把新索引回传，页面据此高亮对应图例行。
     * 双向联动靠这一对「受控属性 + 事件」完成，不依赖页面直接操作组件内部状态。
     */
    activeIndex: { type: Number, value: -1 },
    /**
     * 是否在环外画引线标签。
     *
     * 概览页的保养环图只有 200rpx 宽、右侧还要放图例，标签会挤成一片；
     * 关掉标签后外围留白消失，小尺寸也能画满（图例本身承担了标签作用）。
     */
    showLabels: { type: Boolean, value: true }
  },
  observers: {
    'segments, total, showLabels'() {
      // observers 在组件**首次接收属性**时就会触发，早于 ready()。
      // 此时首次渲染尚未完成，调用 setData 会与首帧数据竞争，
      // 渲染层报 "Expected updated data but get first rendering data"。
      // 因此初始绘制统一交给 ready()，这里只处理「就绪后属性变化」。
      if (!(this as any)._ready) return;
      // 数据换了，旧的选中索引可能越界：清空后由 activeIndex observer 负责重绘；
      // 本来就是 -1 时 setData 不会触发 observer，这里直接画。
      if (this.data.activeIndex !== -1) {
        this.setData({ activeIndex: -1 });
      } else {
        this.draw();
      }
    },
    activeIndex() {
      if (!(this as any)._ready) return;
      this.draw();
    }
  },
  lifetimes: {
    ready() {
      (this as any)._ready = true;
      this.draw();
      /*
       * 条件渲染（wx:if 后才出现）的节点，ready 时布局可能还没完成，
       * canvas 拿到的宽高是 0 → 画布全白、看起来"环图没渲染"。
       * 下一帧再画一次，确保用的是真实尺寸。
       */
      const again = () => this.draw();
      if (typeof wx !== 'undefined' && typeof (wx as any).nextTick === 'function') {
        (wx as any).nextTick(again);
      } else {
        setTimeout(again, 0);
      }
    }
  },
  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches && e.touches[0];
      const lay = (this as any)._layout;
      if (!t || !lay) return;
      // 兼容两种坐标：canvas 内 x/y，或视口 clientX/clientY 减去画布偏移
      const p = toCanvasPoint(t as any, { left: lay.left, top: lay.top });
      if (!p) return;
      const segs = this.data.segments as Segment[];
      if (!segs.length) return;
      // 选中扇区向外凸出，命中必须按各扇区自己的圆心判定
      const hit = hitDonutSegment(
        p.x,
        p.y,
        lay.cx,
        lay.cy,
        lay.innerR,
        lay.outerR,
        segs.map(s => s.percent),
        this.data.activeIndex as number,
        lay.offR
      );
      const next = this.data.activeIndex === hit ? -1 : hit;
      // 重绘交给 activeIndex observer，避免同一次交互画两遍
      this.setData({ activeIndex: next });
      // 通知页面同步图例高亮
      this.triggerEvent('change', { index: next });
    },
    draw() {
      this.createSelectorQuery()
        .select('#donut')
        .fields({ node: true, size: true, rect: true })
        .exec((res: any) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
          const w = res[0].width;
          const h = res[0].height;
          canvas.width = Math.round(w * dpr);
          canvas.height = Math.round(h * dpr);
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, w, h);

          const segs = this.data.segments as Segment[];
          if (!segs.length) return;
          const withLabels = this.data.showLabels !== false;

          // 缓存布局供触摸命中复用：必须与绘制用同一份公式，
          // 否则改任一侧就会点击错位（computeDonutLayout 已抽出共享）
          const geo = computeDonutLayout(w, h, 1, withLabels);
          (this as any)._layout = {
            cx: geo.cx,
            cy: geo.cy,
            outerR: geo.outerR,
            innerR: geo.innerR,
            offR: geo.offR,
            left: res[0].left || 0,
            top: res[0].top || 0
          };

          renderDonut({
            ctx,
            w,
            h,
            segments: segs,
            total: this.data.total as string,
            activeIndex: this.data.activeIndex as number,
            showLabels: withLabels
          });
        });
    }
  }
});
