// 柱状图组件（行程 / 费用按月）：点击柱子高亮并显示数值气泡（R-06）
import { hitBarIndex, toCanvasPoint } from '../../utils/chart-math';
import { CHART_THEME, drawBubble } from '../../utils/chart-draw';

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
          const maxVal = Math.max(...bars.map(b => b.value));
          if (maxVal <= 0) return;

          const padL = 8;
          const padR = 8;
          const padT = 18;
          const padB = 24;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;
          const slot = plotW / bars.length;
          const barW = slot * 0.5;
          (this as any)._layout = {
            left: res[0].left || 0,
            top: res[0].top || 0,
            padL,
            plotW
          };

          const active = this.data.activeIndex as number;

          bars.forEach((b, i) => {
            const cx = padL + slot * i + slot / 2;
            const bh = (b.value / maxVal) * plotH;
            const x = cx - barW / 2;
            const y = padT + plotH - bh;
            const isActive = i === active;

            // 柱子（圆角）
            ctx.fillStyle = isActive ? CHART_THEME.primaryDark : CHART_THEME.primary;
            const r = Math.min(4, barW / 2);
            ctx.beginPath();
            ctx.moveTo(x, padT + plotH);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x, y, x + r, y, r);
            ctx.lineTo(x + barW - r, y);
            ctx.arcTo(x + barW, y, x + barW, y + r, r);
            ctx.lineTo(x + barW, padT + plotH);
            ctx.closePath();
            ctx.fill();
            if (isActive) {
              ctx.strokeStyle = CHART_THEME.card;
              ctx.lineWidth = 2;
              ctx.stroke();
            }

            // 数值标签
            ctx.fillStyle = isActive ? CHART_THEME.primaryDark : CHART_THEME.text3;
            ctx.font = isActive ? 'bold 10px sans-serif' : '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(Math.round(b.value)), cx, y - 4);

            // X 轴标签
            ctx.fillText(b.label, cx, h - 6);
          });

          if (active >= 0 && active < bars.length) {
            const b = bars[active];
            const cx = padL + slot * active + slot / 2;
            const y = padT + plotH - (b.value / maxVal) * plotH;
            drawBubble(ctx, {
              text: `${b.label} · ${Math.round(b.value)}${this.data.unit}`,
              x: cx,
              y: y - 20,
              w,
              h
            });
          }
        });
    }
  }
});
