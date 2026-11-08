// 折线图组件（油耗趋势）：点击数据点高亮并显示数值气泡（R-06）
import { MAX_FUEL_CONSUMPTION } from '../../domain/fuel.service';
import { hitLineIndex, toCanvasPoint } from '../../utils/chart-math';
import { drawBubble } from '../../utils/chart-draw';
import { CHART_THEME } from '../../utils/chart-theme';

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

          // yMax 随实际数据抬高（取 5 的倍数），上限与领域层油耗上限一致
          const maxValue = Math.max(...pts.map(p => Number(p.value) || 0));
          const baseYMax = this.data.yMax || 15;
          const yMax = Math.min(
            MAX_FUEL_CONSUMPTION,
            Math.max(baseYMax, Math.ceil(maxValue / 5) * 5)
          );
          const padL = 28;
          const padR = 12;
          const padT = 24;
          const padB = 24;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;
          // 缓存布局供触摸命中复用（含画布在视口中的偏移）
          (this as any)._layout = {
            left: res[0].left || 0,
            top: res[0].top || 0,
            padL,
            plotW
          };

          const x = (i: number) =>
            pts.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (pts.length - 1);
          const y = (v: number) => {
            const clamped = Math.max(0, Math.min(Number(v) || 0, yMax));
            return padT + plotH * (1 - clamped / yMax);
          };

          // 网格线（0 / 中 / 顶）
          ctx.strokeStyle = CHART_THEME.grid;
          ctx.lineWidth = 1;
          [0, 0.5, 1].forEach(ratio => {
            const gy = padT + plotH * ratio;
            ctx.beginPath();
            ctx.moveTo(padL, gy);
            ctx.lineTo(w - padR, gy);
            ctx.stroke();
          });

          // 折线（单区间时只画数据点与数值标注）
          if (pts.length > 1) {
            ctx.beginPath();
            pts.forEach((p, i) => {
              if (i === 0) ctx.moveTo(x(i), y(p.value));
              else ctx.lineTo(x(i), y(p.value));
            });
            ctx.strokeStyle = CHART_THEME.primary;
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // 数据点 + 数值标注
          const spacing = plotW / Math.max(1, pts.length - 1);
          const dense = spacing < 36;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';

          pts.forEach((p, i) => {
            const px = x(i);
            const py = y(p.value);

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = CHART_THEME.primary;
            ctx.fill();

            let ty = py - 9;
            if (ty < padT + 9) ty = py + 17;
            else if (dense && i % 2 === 1) ty = py + 17;
            if (ty > h - padB - 2) ty = py - 9;

            ctx.fillStyle = CHART_THEME.primary;
            ctx.fillText(p.value.toFixed(2), px, ty);
          });

          // X 轴标签（最多 6 个）
          ctx.fillStyle = CHART_THEME.text3;
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          const step = Math.ceil(pts.length / 6);
          pts.forEach((p, i) => {
            if (i % step !== 0 && i !== pts.length - 1) return;
            ctx.fillText(p.label, x(i), h - 6);
          });

          // 选中点高亮 + 数值气泡
          const active = this.data.activeIndex as number;
          if (active >= 0 && active < pts.length) {
            const p = pts[active];
            const px = x(active);
            const py = y(p.value);
            ctx.beginPath();
            ctx.arc(px, py, 7, 0, Math.PI * 2);
            ctx.strokeStyle = CHART_THEME.primary;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = CHART_THEME.card;
            ctx.fill();
            drawBubble(ctx, {
              text: `${p.label} · ${p.value.toFixed(2)} ${this.data.unit}`,
              x: px,
              y: py - 26,
              w,
              h
            });
          }
        });
    }
  }
});
