// 分类支出环形图：外标签引线 + 点击放大 + 气泡 + 中心金额
import { hitDonutSegment, toCanvasPoint, layoutDonutLabels } from '../../utils/chart-math';
import { CHART_THEME, drawBubble } from '../../utils/chart-draw';

interface Segment {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

/** 外标签字号与行高（逻辑像素）：minGap 取行高可保证两行文字不粘连 */
const LABEL_FONT = '10px sans-serif';
const LABEL_LINE_HEIGHT = 14;

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

          const cx = w / 2;
          const cy = h / 2;
          const labelSpace = Math.max(70, w * 0.26);
          const outerR = Math.min(w / 2 - labelSpace, h / 2 - 14);
          if (outerR < 20) return;
          const innerR = outerR * 0.55;
          (this as any)._layout = {
            cx,
            cy,
            outerR,
            innerR,
            left: res[0].left || 0,
            top: res[0].top || 0,
            offR: 10
          };

          const active = this.data.activeIndex as number;
          const offR = 10;

          // 扇区（选中外移 + 其余变淡）
          let start = -Math.PI / 2;
          segs.forEach((seg, i) => {
            const angle = (seg.percent / 100) * Math.PI * 2;
            const mid = start + angle / 2;
            const isActive = i === active;
            const ox = isActive ? Math.cos(mid) * offR : 0;
            const oy = isActive ? Math.sin(mid) * offR : 0;

            ctx.beginPath();
            ctx.arc(cx + ox, cy + oy, outerR, start, start + angle);
            ctx.arc(cx + ox, cy + oy, innerR, start + angle, start, true);
            ctx.closePath();
            ctx.globalAlpha = active >= 0 && !isActive ? 0.28 : 1;
            ctx.fillStyle = seg.color;
            ctx.fill();
            ctx.globalAlpha = 1;
            if (isActive) {
              ctx.strokeStyle = CHART_THEME.card;
              ctx.lineWidth = 3;
              ctx.stroke();
            }
            start += angle;
          });

          // 中心金额
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = CHART_THEME.text1;
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText(`¥${this.data.total}`, cx, cy - 7);
          ctx.fillStyle = CHART_THEME.text3;
          ctx.font = '10px sans-serif';
          ctx.fillText('总支出', cx, cy + 13);

          // 外标签引线 + 标注「名字 百分比%」
          // 标签位置经 layoutDonutLabels 防重叠处理：小占比扇区相邻时自动上下推开，
          // 引线折点 y 跟随标签 y，因此引线不会交叉。
          start = -Math.PI / 2;
          const mids: number[] = [];
          segs.forEach(seg => {
            const angle = (seg.percent / 100) * Math.PI * 2;
            mids.push(start + angle / 2);
            start += angle;
          });
          const labels = layoutDonutLabels({
            segments: segs.map((seg, i) => ({ mid: mids[i], percent: seg.percent })),
            cx,
            cy,
            outerR,
            minY: LABEL_LINE_HEIGHT / 2 + 2,
            maxY: h - LABEL_LINE_HEIGHT / 2 - 2,
            minGap: LABEL_LINE_HEIGHT,
            elbowGap: 13,
            tailGap: 4
          });

          ctx.font = LABEL_FONT;
          ctx.textBaseline = 'middle';
          segs.forEach((seg, i) => {
            const lay = labels[i];
            ctx.beginPath();
            ctx.moveTo(lay.anchorX, lay.anchorY);
            ctx.lineTo(lay.elbowX, lay.elbowY);
            ctx.lineTo(lay.x, lay.elbowY);
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = 1;
            ctx.stroke();

            const label = `${seg.name} ${seg.percent.toFixed(2)}%`;
            ctx.fillStyle = CHART_THEME.label;
            ctx.textAlign = lay.side === 'right' ? 'left' : 'right';
            ctx.fillText(label, lay.x, lay.y);
          });

          // 选中气泡（复用共享绘制）
          if (active >= 0) {
            const seg = segs[active];
            let s = -Math.PI / 2;
            for (let i = 0; i < active; i++) s += (segs[i].percent / 100) * Math.PI * 2;
            const a = (seg.percent / 100) * Math.PI * 2;
            const mid = s + a / 2;
            const ox = Math.cos(mid) * offR;
            const oy = Math.sin(mid) * offR;
            const r = (outerR + innerR) / 2;
            drawBubble(ctx, {
              text: `${seg.name}：¥${seg.amount}（${seg.percent.toFixed(2)}%）`,
              x: cx + ox + Math.cos(mid) * r,
              y: cy + oy + Math.sin(mid) * r,
              w,
              h
            });
          }
        });
    }
  }
});
