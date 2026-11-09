// 柱状图组件（行程 / 费用按月）：点击柱子高亮并显示数值气泡（R-06）
// 绘制算法已抽到 utils/chart-render.ts，与统计页分享卡片共用同一份实现。
import { hitBarIndex, toCanvasPoint } from '../../utils/chart-math';
import { renderBars, computeBarLayout } from '../../utils/chart-render';

Component({
  properties: {
    bars: { type: Array, value: [] }, // [{ label, value }]
    unit: { type: String, value: '' }
  },
  data: {
    activeIndex: -1
  },
  observers: {
    bars() {
      this.setData({ activeIndex: -1 });
      this.draw();
    }
  },
  lifetimes: {
    ready() {
      this.draw();
    }
  },
  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches && e.touches[0];
      const lay = (this as any)._layout;
      if (!t || !lay) return;
      const p = toCanvasPoint(t as any, { left: lay.left, top: lay.top });
      if (!p) return;
      const bars = (this.data.bars || []) as Array<{ label: string; value: number }>;
      const hit = hitBarIndex(p.x, bars.length, lay.padL, lay.plotW);
      const next = this.data.activeIndex === hit ? -1 : hit;
      this.setData({ activeIndex: next });
      this.draw();
    },
    draw() {
      this.createSelectorQuery()
        .select('#bar')
        .fields({ node: true, size: true, rect: true })
        .exec((res: any) => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
          const w = res[0].width;
          const h = res[0].height;
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, w, h);

          const bars = (this.data.bars || []) as Array<{ label: string; value: number }>;
          if (!bars.length) return;

          // 缓存布局供触摸命中复用：与绘制共用同一份公式
          const geo = computeBarLayout(w, h, bars, 1);
          (this as any)._layout = {
            left: res[0].left || 0,
            top: res[0].top || 0,
            padL: geo.padL,
            plotW: geo.plotW
          };

          renderBars({
            ctx,
            w,
            h,
            bars,
            activeIndex: this.data.activeIndex as number
          });
        });
    }
  }
});
