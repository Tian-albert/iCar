// 环形图组件（分类支出占比）
Component({
  properties: {
    segments: { type: Array, value: [] } // [{ name, amount, percent, color }]
  },
  observers: {
    segments() {
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

          const segs = this.data.segments || [];
          if (!segs.length) return;
          const cx = w / 2;
          const cy = h / 2;
          const radius = Math.min(w, h) / 2 - 2;
          const thickness = radius * 0.42;
          let start = -Math.PI / 2;
          segs.forEach((seg: any) => {
            const angle = ((seg.percent || 0) / 100) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius - thickness / 2, start, start + angle);
            ctx.strokeStyle = seg.color || '#999';
            ctx.lineWidth = thickness;
            ctx.stroke();
            start += angle;
          });
        });
    }
  }
});
