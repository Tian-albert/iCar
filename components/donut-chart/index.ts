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
    total: { type: String, value: '' }
  },
  data: {
    activeIndex: -1
  },
  observers: {
    'segments, total'() {
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
      this.setData({ activeIndex: next });
      this.draw();
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
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          ctx.scale(dpr, dpr);
          ctx.clearRect(0, 0, w, h);

          const segs = this.data.segments as Segment[];
          if (!segs.length) return;

          // 缓存布局供触摸命中复用：必须与绘制用同一份公式，
          // 否则改任一侧就会点击错位（computeDonutLayout 已抽出共享）
          const geo = computeDonutLayout(w, h, 1);
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
            activeIndex: this.data.activeIndex as number
          });
        });
    }
  }
});
