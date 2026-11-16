// 概览 Tab（原「保养」Tab）：全局面板
//
// 与原「保养」页的区别：原页只显示置顶车，现在跨全部车汇总 ——
// 保养总览、按车花费、最近流水、漏记提醒都是「统计页做不到」的跨车视角。
import { getStorage } from '../../store/index';
import {
  buildOverview,
  toIntegerPercents,
  OverviewSnapshot
} from '../../services/overview.service';
import { renderDonut, computeDonutLayout, DonutSegment } from '../../utils/chart-render';

/** 环图逻辑尺寸（px，375 屏宽下 104px ≈ 208rpx） */
const DONUT_SIZE = 104;

interface MaintainView {
  key: string;
  carSourceId: string;
  carName: string;
  name: string;
  remainText: string;
  level: string;
}

interface CarCostView {
  carSourceId: string;
  carName: string;
  amountText: string;
  percentText: string;
  color: string;
}

interface RecentView {
  key: string;
  carSourceId: string;
  carName: string;
  dateText: string;
  typeLabel: string;
  amountText: string;
  section: string;
}

/** 千分位整数 */
function fmtInt(n: number): string {
  const v = Math.round(n);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 金额保留两位；整数则不带小数 */
function fmtMoney(n: number): string {
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? fmtInt(v) : v.toFixed(2);
}

/** 相对日期：今天 / 昨天 / M-D */
function relativeDate(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 距今天数的口语化 */
function daysAgoText(days: number | null): string {
  if (days === null) return '—';
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

Component({
  data: {
    hasCar: false,
    carCount: 0,
    totalMileageText: '0',
    monthCostText: '0',
    pendingCount: 0,
    lastRecordText: '—',
    yearTotalText: '0',
    /** 今年是否有支出：为 false 时环图区显示空态 */
    hasYearCost: false,
    stale: null as { carName: string; days: number } | null,
    maintain: [] as MaintainView[],
    carCosts: [] as CarCostView[],
    recent: [] as RecentView[],
    donutSegments: [] as DonutSegment[],
    /** 主车 id：管理保养项时用 */
    mainCarId: ''
  },

  lifetimes: {
    attached() {
      // 组件挂载即拉一次数据；之后每次切到本 tab 由宿主页调 onShown 刷新
      (this as any).load();
    },
    ready() {
      // 把实例上报给父级（tab-swiper），父级切 tab 时据此调用 onShown 刷新
      this.triggerEvent('ready', { index: this.data.index, instance: this });
    }
  },

  methods: {
  /** 供宿主页取分享内容（组件内不能直接接管页面分享） */
  getShareHighlight(): string {
    if (!this.data.hasCar) return '';
    return `今年已记 ${this.data.yearTotalText} 元，${this.data.carCount} 辆车一目了然`;
  },

  /**
   * 宿主页在 swiper 切到本组件时调用：刷新数据并重绘环图。
   *
   * 组件没有 onShow，必须由宿主页主动通知，否则切回来时数据是旧的。
   */
  onShown() {
    this.load();
  },

  load() {
    const storage = getStorage();
    const now = Date.now();
    const snap: OverviewSnapshot = buildOverview(storage, now);

    if (snap.metric.carCount === 0) {
      this.setData({ hasCar: false, donutSegments: [] });
      return;
    }

    // 环图扇区：百分比按金额算，颜色与图例一致
    const segments: DonutSegment[] = snap.carCosts
      .filter(c => c.amount > 0)
      .map(c => ({
        name: c.carName,
        amount: fmtMoney(c.amount),
        percent: c.percent,
        color: c.color
      }));

    // 图例的整数百分比必须合计 100，否则与环图铺满一圈矛盾
    const intPercents = toIntegerPercents(snap.carCosts.map(c => c.percent));

    this.setData(
      {
        hasCar: true,
        carCount: snap.metric.carCount,
        totalMileageText: fmtInt(snap.metric.totalMileage),
        monthCostText: fmtMoney(snap.metric.monthCost),
        pendingCount: snap.pendingCount,
        lastRecordText: daysAgoText(snap.metric.lastRecordDays),
        yearTotalText: fmtInt(snap.yearTotal),
        hasYearCost: snap.yearTotal > 0,
        stale: snap.stale ? { carName: snap.stale.carName, days: snap.stale.days } : null,
        maintain: snap.maintain.map((m, i) => ({
          key: `${m.carSourceId}-${m.name}-${i}`,
          carSourceId: m.carSourceId,
          carName: m.carName,
          name: m.name,
          remainText: m.remainText,
          level: m.level
        })),
        carCosts: snap.carCosts.map((c, i) => ({
          carSourceId: c.carSourceId,
          carName: c.carName,
          amountText: fmtInt(c.amount),
          // 整数百分比：逐项四舍五入后合计可能只有 99%，把误差补给占比最大的一项
          percentText: `${intPercents[i]}%`,
          color: c.color
        })),
        recent: snap.recent.map((r, i) => ({
          key: `${r.carSourceId}-${r.date}-${i}`,
          carSourceId: r.carSourceId,
          carName: r.carName,
          dateText: relativeDate(r.date, now),
          typeLabel: r.typeLabel,
          amountText: fmtMoney(r.amount),
          section: r.section
        })),
        donutSegments: segments,
        mainCarId: snap.mainCarId
      },
      () => this.drawDonut()
    );
  },

  /** 用共享 renderDonut 画环图（无外标签，中心显示今年合计） */
  drawDonut() {
    this.createSelectorQuery()
      .select('#overviewDonut')
      .fields({ node: true, size: true })
      .exec(res => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) return;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        // 重设 width/height 会同时清空位图 —— 必须在「无数据」分支之前做，
        // 否则删光支出后画布仍保留上一次的环图
        canvas.width = DONUT_SIZE * dpr;
        canvas.height = DONUT_SIZE * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const segments = this.data.donutSegments;
        if (!segments.length) {
          ctx.clearRect(0, 0, DONUT_SIZE, DONUT_SIZE);
          return;
        }

        // 中心金额按实际测量宽度缩字号：内圈直径只有约 53px，
        // 金额到 10 万以上（如 ¥123,456）就会压到色环上。
        // 用 measureText 而不是按字符数估算，能覆盖任意位数。
        const geo = computeDonutLayout(DONUT_SIZE, DONUT_SIZE, 1, false);
        const maxTextW = geo.innerR * 2 - 6;
        const centerText = `¥${this.data.yearTotalText}`;
        ctx.font = 'bold 14px sans-serif';
        const measured = ctx.measureText(centerText).width;
        const fontScale = measured > maxTextW ? Math.max(0.55, maxTextW / measured) : 1;

        renderDonut({
          ctx,
          w: DONUT_SIZE,
          h: DONUT_SIZE,
          segments,
          total: this.data.yearTotalText,
          showLabels: false,
          centerLabel: '今年合计',
          fontScale
        });
      });
  },

  /** 点某条保养项 → 该车详情的「保养进度」 */
  onTapMaintain(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.car as string;
    wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${id}&section=maintain` });
  },

  /** 点某条流水 → 该车详情对应区块 */
  onTapRecord(e: WechatMiniprogram.TouchEvent) {
    const id = e.currentTarget.dataset.car as string;
    const section = (e.currentTarget.dataset.section as string) || 'costs';
    wx.navigateTo({ url: `/pages/vehicle-detail/index?id=${id}&section=${section}` });
  },

  /** 管理保养项：跳到主车（多车时的取舍，与 Hero 主车规则一致） */
  onManageMaintain() {
    const id = this.data.mainCarId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/maintain-manage/index?id=${id}` });
  },

  onAddCar() {
    wx.navigateTo({ url: '/pages/vehicle-form/index' });
  }
  }
});
