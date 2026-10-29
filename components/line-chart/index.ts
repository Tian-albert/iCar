// 折线图组件（油耗趋势）
Component({
  properties: {
    points: { type: Array, value: [] }, // [{ label, value }]
    yMax: { type: Number, value: 15 }
  },
  observers: {
    points() {
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
        .select('#line')
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

          const pts = (this.data.points || []) as Array<{ label: string; value: number }>;
          if (pts.length < 2) return;

          const yMax = this.data.yMax || 15;
          const padL = 28;
          const padR = 12;
          const padT = 24; // 顶部留出数值标注空间
          const padB = 24;
          const plotW = w - padL - padR;
          const plotH = h - padT - padB;
          const x = (i: number) => padL + (plotW * i) / (pts.length - 1);
          const y = (v: number) => padT + plotH * (1 - v / yMax);

          // 网格线（0 / 中 / 顶）
          ctx.strokeStyle = '#EEF0F3';
          ctx.lineWidth = 1;
          [0, 0.5, 1].forEach(ratio => {
            const gy = padT + plotH * ratio;
            ctx.beginPath();
            ctx.moveTo(padL, gy);
            ctx.lineTo(w - padR, gy);
            ctx.stroke();
          });

          // 折线
          ctx.beginPath();
          pts.forEach((p, i) => {
            if (i === 0) ctx.moveTo(x(i), y(p.value));
            else ctx.lineTo(x(i), y(p.value));
          });
          ctx.strokeStyle = '#3B6FF6';
          ctx.lineWidth = 2;
          ctx.stroke();

          // 数据点 + 数值标注
          const spacing = plotW / Math.max(1, pts.length - 1);
          const dense = spacing < 36; // 点距过近时上下交错，减少标签重叠
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';

          pts.forEach((p, i) => {
            const px = x(i);
            const py = y(p.value);

            ctx.beginPath();
            ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#3B6FF6';
            ctx.fill();

            // 默认标在点上方；顶部空间不足或标签过密时改到点下方
            let ty = py - 9;
            if (ty < padT + 9) ty = py + 17;
            else if (dense && i % 2 === 1) ty = py + 17;
            // 下方空间不足时回退到点上方，避免压到 X 轴标签
            if (ty > h - padB - 2) ty = py - 9;

            ctx.fillStyle = '#3B6FF6';
            ctx.fillText(p.value.toFixed(2), px, ty);
          });

          // X 轴标签（最多 6 个）
          ctx.fillStyle = '#9AA4B2';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          const step = Math.ceil(pts.length / 6);
          pts.forEach((p, i) => {
            if (i % step !== 0 && i !== pts.length - 1) return;
            ctx.fillText(p.label, x(i), h - 6);
          });
        });
    }
  }
});
