// 折线图组件（油耗趋势）：点击数据点高亮并显示数值气泡（R-06）
// 绘制算法已抽到 utils/chart-render.ts，与统计页分享卡片共用同一份实现。
import { hitLineIndex, toCanvasPoint } from '../../utils/chart-math';
import { renderLine } from '../../utils/chart-render';
import { MAX_EV_CONSUMPTION } from '../../domain/fuel.service';

Component({
  properties: {
    points: { type: Array, value: [] }, // [{ label, value }]
    yMax: { type: Number, value: 15 },
    unit: { type: String, value: 'L/100km' }
  },
  data: {
    activeIndex: -1
  },
  observers: {
    points() {
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
      const pts = (this.data.points || []) as Array<{ label: string; value: number }>;
      const hit = hitLineIndex(p.x, pts.length, lay.padL, lay.plotW);
      const next = this.data.activeIndex === hit ? -1 : hit;
      this.setData({ activeIndex: next });
      this.draw();
    },
    draw() {
      this.createSelectorQuery()
        .select('#line')
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

          const pts = (this.data.points || []) as Array<{ label: string; value: number }>;
          if (pts.length === 0) return;

          // 缓存布局供触摸命中复用
          (this as any)._layout = {
            left: res[0].left || 0,
            top: res[0].top || 0,
            padL: 28,
            plotW: w - 40
          };

          // 单位含 kWh 即电耗，用 50 封顶；否则按油耗 30
          const unit = (this.data.unit as string) || '';
          const ceiling = unit.indexOf('kWh') >= 0 ? MAX_EV_CONSUMPTION : undefined;

          renderLine({
            ctx,
            w,
            h,
            points: pts,
            yMax: this.data.yMax as number,
            activeIndex: this.data.activeIndex as number,
            ceiling
          });
        });
    }
  }
});
