// 柱状图组件（行程 / 费用按月）
Component({
  properties: {
    bars: { type: Array, value: [] } // [{ label, value }]
  },
  observers: {
    bars() {
      this.draw();
    }
  },
  lifetimes: {
    ready() {
      this.draw();
    }
  },
  methods: {
    draw() {
      this.createSelectorQuery()
        .select('#bar')
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

          bars.forEach((b, i) => {
            const cx = padL + slot * i + slot / 2;
            const bh = (b.value / maxVal) * plotH;
            const x = cx - barW / 2;
            const y = padT + plotH - bh;

            // 柱子（圆角）
            ctx.fillStyle = '#3B6FF6';
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

            // 数值标签
            ctx.fillStyle = '#9AA4B2';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(Math.round(b.value)), cx, y - 4);

            // X 轴标签
            ctx.fillText(b.label, cx, h - 6);
          });
        });
    }
  }
});
