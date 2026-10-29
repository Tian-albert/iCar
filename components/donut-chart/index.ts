// 分类支出环形图：外标签引线 + 点击放大 + 气泡 + 中心金额
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
      const t = e.touches && (e.touches[0] as any);
      if (!t || typeof t.x !== 'number' || typeof t.y !== 'number') return;
      const segs = this.data.segments as Segment[];
      if (!segs.length) return;
      const hit = this.hitTest(t.x, t.y);
      const next = this.data.activeIndex === hit ? -1 : hit;
      this.setData({ activeIndex: next });
      this.draw();
    },
    hitTest(x: number, y: number): number {
      const lay = (this as any)._layout;
      if (!lay) return -1;
      const dx = x - lay.cx;
      const dy = y - lay.cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < lay.innerR - 6 || r > lay.outerR + 6) return -1;
      let ang = Math.atan2(dy, dx) + Math.PI / 2;
      if (ang < 0) ang += Math.PI * 2;
      const segs = this.data.segments as Segment[];
      let acc = 0;
      for (let i = 0; i < segs.length; i++) {
        const a = (segs[i].percent / 100) * Math.PI * 2;
        if (ang >= acc && ang < acc + a) return i;
        acc += a;
      }
      return -1;
    },
    draw() {
      this.createSelectorQuery()
        .select('#donut')
        .fields({ node: true, size: true })
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
          (this as any)._layout = { cx, cy, outerR, innerR };

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
              ctx.strokeStyle = '#FFFFFF';
              ctx.lineWidth = 3;
              ctx.stroke();
            }
            start += angle;
          });

          // 中心金额
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#1F2430';
          ctx.font = 'bold 14px sans-serif';
          ctx.fillText(`¥${this.data.total}`, cx, cy - 7);
          ctx.fillStyle = '#9AA4B2';
          ctx.font = '10px sans-serif';
          ctx.fillText('总支出', cx, cy + 13);

          // 外标签引线 + 标注「名字 百分比%」
          start = -Math.PI / 2;
          ctx.font = '10px sans-serif';
          ctx.textBaseline = 'middle';
          segs.forEach((seg, i) => {
            const angle = (seg.percent / 100) * Math.PI * 2;
            const mid = start + angle / 2;
            const cos = Math.cos(mid);
            const sin = Math.sin(mid);
            const x1 = cx + cos * (outerR + 2);
            const y1 = cy + sin * (outerR + 2);
            const x2 = cx + cos * (outerR + 13);
            const y2 = cy + sin * (outerR + 13);
            const x3 = cx + cos * (outerR + 17) + (cos >= 0 ? 3 : -3);

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineTo(x3, y2);
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = 1;
            ctx.stroke();

            const label = `${seg.name} ${seg.percent.toFixed(2)}%`;
            ctx.fillStyle = '#4A5363';
            ctx.textAlign = cos >= 0 ? 'left' : 'right';
            ctx.fillText(label, x3, y2);
            start += angle;
          });

          // 选中气泡
          if (active >= 0) {
            const seg = segs[active];
            let s = -Math.PI / 2;
            for (let i = 0; i < active; i++) s += (segs[i].percent / 100) * Math.PI * 2;
            const a = (seg.percent / 100) * Math.PI * 2;
            const mid = s + a / 2;
            const ox = Math.cos(mid) * offR;
            const oy = Math.sin(mid) * offR;
            this.drawBubble(ctx, seg, mid, cx + ox, cy + oy, outerR, innerR, w, h);
          }
        });
    },
    drawBubble(
      ctx: any,
      seg: Segment,
      mid: number,
      cx: number,
      cy: number,
      outerR: number,
      innerR: number,
      w: number,
      h: number
    ) {
      const text = `${seg.name}：¥${seg.amount}（${seg.percent.toFixed(2)}%）`;
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(text).width;
      const bw = tw + 24;
      const bh = 28;
      const r = (outerR + innerR) / 2;
      let bx = cx + Math.cos(mid) * r - bw / 2;
      let by = cy + Math.sin(mid) * r - bh / 2;
      bx = Math.max(3, Math.min(w - bw - 3, bx));
      by = Math.max(3, Math.min(h - bh - 3, by));

      // 阴影
      ctx.fillStyle = 'rgba(15,23,42,0.10)';
      this.roundRect(ctx, bx + 1, by + 2, bw, bh, 8);
      ctx.fill();

      this.roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#E6EAF1';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#1F2430';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(text, bx + bw / 2, by + bh / 2 + 1);
    },
    roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }
});
