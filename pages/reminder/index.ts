// 概览 Tab：全局面板
//
// 区块：数据总览 / 漏记提醒 / 保养提醒 / 今年花费按车 / 最近记录 / 出行成本
//
// 关于「总里程」口径：一律使用**建档后行驶里程**（当前里程 − 购车时里程）。
// 顶部指标、出行成本图块、每公里成本的分母三者必须是同一口径，
// 否则会出现「顶部 12 万公里、每公里成本却按 4.6 万算」的矛盾。
import { getStorage } from '../../store/index';
import {
  buildOverview,
  toIntegerPercents,
  OverviewSnapshot
} from '../../services/overview.service';
import { listCars } from '../../services/car.service';
import { getMaintainProgressBatch } from '../../services/maintain-record.service';
import { isRemainOverdue } from '../../domain/maintain.service';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';
import { renderDonut, computeDonutLayout, DonutSegment } from '../../utils/chart-render';
import { hitDonutSegment, toCanvasPoint } from '../../utils/chart-math';
import { displayIcon, isImageIcon } from '../../utils/icons';
import {
  formatCompact,
  formatMoneyKmPair,
  formatPerKm,
  thousands
} from '../../utils/num-format';
import { CHART_COLORS } from '../../domain/stats.service';

/**
 * 环图逻辑高度（px）。
 * 带引出标签后需要上下留白，比原来 104×104 的无标签版本高得多。
 */
const DONUT_H = 186;

/** 取不到画布宽度时的兜底（px，375 屏下的卡片内容宽） */
const DONUT_FALLBACK_W = 319;

/** 竖线总占宽：1px 线 + 左右各 6px 边距（与 wxss 的 .t-vline 对应） */
const VLINE_TOTAL = 13;

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
  /** 占比（0~100 的小数），用于比例条宽度 */
  percent: number;
  color: string;
  /** 对应环图扇区索引；该车本年无支出时为 -1 */
  segIndex: number;
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

interface DrivingCostView {
  carSourceId: string;
  carName: string;
  icon: string;
  isImage: boolean;
  emoji: string;
  /** 图标底色：车辆色的低透明度版本 */
  iconBg: string;
  color: string;
  daysText: string;
  perKmText: string;
  spendText: string;
  kmText: string;
  /** 金额与里程共用的字号 */
  fontText: string;
}

/** 千分位整数 */
function fmtInt(n: number): string {
  return thousands(n);
}

/** 金额保留两位；整数则不带小数（用于流水与图例） */
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

/** 十六进制色 → 低透明度 rgba，用作图标底色 */
function tint(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(59, 111, 246, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(59, 111, 246, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 出行成本图块里「单列」的可用宽度（px）。
 *
 * 与 wxss 的尺寸一一对应：
 *   页面左右 padding 24rpx × 2 + 卡片左右 padding 32rpx × 2
 *   两列之间 gap 20rpx
 *   图块左右 padding 24rpx × 2
 *   再减去竖线占宽，两等分
 * 375 屏下结果正好是 58.75px。
 */
function cellAvailableWidth(): number {
  const info: any = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const winW = (info && info.windowWidth) || 375;
  const rpx = winW / 750;
  const cardInner = winW - (24 * 2 + 32 * 2) * rpx;
  const tileW = (cardInner - 20 * rpx) / 2;
  const tileInner = tileW - 24 * 2 * rpx;
  return Math.max(30, (tileInner - VLINE_TOTAL) / 2);
}

Page({
  data: {
    hasCar: false,
    carCount: 0,
    /** 本年总支出（顶部指标） */
    yearTotalText: '0',
    /** 建档后行驶里程合计（顶部指标） */
    totalDrivenText: '0',
    pendingCount: 0,
    stale: null as { carName: string; days: number } | null,
    /** 保养到期提醒总开关：关闭时隐藏整个保养提醒区块 */
    remindEnabled: true,
    /** 保养状态环图：超期 / 临近 / 正常 的项数占比 */
    mntSegments: [] as Array<{ name: string; amount: string; percent: number; color: string }>,
    mntTotalText: '',
    mntBad: 0,
    mntWarn: 0,
    mntOk: 0,
    mntTotal: 0,
    carCosts: [] as CarCostView[],
    recent: [] as RecentView[],
    drivingCosts: [] as DrivingCostView[],
    donutSegments: [] as DonutSegment[],
    /** 环图当前选中扇区，-1 表示未选中 */
    donutActive: -1,
    /** 今年是否有支出：为 false 时环图区显示空态 */
    hasYearCost: false,
    /** 主车 id：管理保养项时用 */
    mainCarId: ''
  },

  onShareAppMessage() {
    return buildShareMessage({ highlight: this.shareHighlight() });
  },
  onShareTimeline() {
    return buildTimelineMessage({ highlight: this.shareHighlight() });
  },
  shareHighlight(): string {
    if (!this.data.hasCar) return '';
    return `今年已记 ${this.data.yearTotalText} 元，${this.data.carCount} 辆车一目了然`;
  },

  onShow() {
    const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tab) {
      tab.setData({ selected: 0 });
      // 每个 tab 页各自持有一份底栏组件实例，切页时必须显式对齐皮肤：
      // 组件内的 pageLifetimes.show 在部分基础库/场景下不触发，会停留在旧皮肤。
      if (typeof tab.refreshSkin === 'function') tab.refreshSkin();
    }
    enableShareMenu();
    this.load();
  },

  onReady() {
    this.drawDonut();
  },

  load() {
    const storage = getStorage();
    const now = Date.now();
    const snap: OverviewSnapshot = buildOverview(storage, now);

    if (snap.metric.carCount === 0) {
      this.setData({ hasCar: false, donutSegments: [], donutActive: -1 });
      return;
    }

    // ---- 环图与图例共用同一份数据：只保留本年有支出的车 ----
    // 两者若各用一份，会出现「环图 3 段、图例 4 行（其中一行 ¥0）」的错位
    const yearCars = snap.carCosts.filter(c => c.amount > 0);

    const segments: DonutSegment[] = yearCars.map(c => ({
      name: c.carName,
      amount: formatCompact(c.amount),
      percent: c.percent,
      color: c.color
    }));

    // 外标签用整数百分比，且合计必须正好 100（否则环图铺满一圈却标 99%）
    const intPercents = toIntegerPercents(segments.map(s => s.percent));

    // ---- 出行成本：颜色沿用环图配色，保证同一辆车两处颜色一致 ----
    const colorOf: Record<string, string> = {};
    snap.carCosts.forEach(c => {
      colorOf[c.carSourceId] = c.color;
    });
    const available = cellAvailableWidth();

    const drivingCosts: DrivingCostView[] = snap.drivingCosts.map((d, i) => {
      const color = colorOf[d.carSourceId] || CHART_COLORS[i % CHART_COLORS.length];
      const pair = formatMoneyKmPair(d.totalSpend, d.drivenKm, available);
      return {
        carSourceId: d.carSourceId,
        carName: d.carName,
        icon: d.icon,
        isImage: isImageIcon(d.icon || ''),
        emoji: displayIcon(d.icon || 'car'),
        iconBg: tint(color, 0.12),
        color,
        daysText: thousands(d.days),
        perKmText: formatPerKm(d.totalSpend, d.drivenKm),
        spendText: pair.moneyText,
        kmText: pair.kmText,
        fontText: String(pair.font)
      };
    });

    this.setData(
      {
        hasCar: true,
        carCount: snap.metric.carCount,
        yearTotalText: formatCompact(snap.yearTotal),
        // 与出行成本图块同一套压缩规则：≥10 万用「万」，避免超大值撑破指标格
        totalDrivenText: formatCompact(snap.metric.totalDrivenMileage),
        pendingCount: snap.pendingCount,
        stale: snap.stale ? { carName: snap.stale.carName, days: snap.stale.days } : null,
        remindEnabled: snap.remindEnabled,
        ...this.buildMaintainRing(storage, now),
        carCosts: yearCars.map((c, i) => ({
          carSourceId: c.carSourceId,
          carName: c.carName,
          amountText: formatCompact(c.amount),
          percent: c.percent,
          color: c.color,
          // 与 segments 一一对应，点图例等同于点扇区
          segIndex: i
        })),
        recent: snap.recent.map(r => ({
          // 用流水自身的 sourceId：插入新记录时只有新增那条是新 key
          key: r.sourceId,
          carSourceId: r.carSourceId,
          carName: r.carName,
          dateText: relativeDate(r.date, now),
          typeLabel: r.typeLabel,
          amountText: fmtMoney(r.amount),
          section: r.section
        })),
        drivingCosts,
        donutSegments: segments,
        // 车数或本年支出变化后，旧的选中索引可能越界
        donutActive:
          this.data.donutActive >= 0 && this.data.donutActive < segments.length
            ? this.data.donutActive
            : -1,
        hasYearCost: segments.length > 0,
        mainCarId: snap.mainCarId
      },
      () => this.drawDonut()
    );

    // 环图标签的整数百分比放在实例上：只给绘制用，没必要进 data（会多一次跨线程传输）
    (this as any)._intPercents = intPercents;
  },

  /**
   * 画环图（带引出标签）。
   *
   * 尺寸用实测宽度：标签要占左右两侧，环图必须按卡片实际宽度布局，
   * 写死 104px 会导致标签被裁掉。
   */
  drawDonut() {
    this.createSelectorQuery()
      .select('#overviewDonut')
      .fields({ node: true, size: true, rect: true })
      .exec(res => {
        const info: any = res && res[0];
        const canvas = info && info.node;
        if (!canvas) return;

        const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
        // 宽高都按实测值：写死逻辑尺寸而 CSS 用 rpx 时，大屏上会被拉伸变形
        const w = info.width > 0 ? Math.round(info.width * 100) / 100 : DONUT_FALLBACK_W;
        const h = info.height > 0 ? Math.round(info.height * 100) / 100 : DONUT_H;

        // 重设 width/height 会同时清空位图 —— 必须在「无数据」分支之前做，
        // 否则删光支出后画布仍保留上一次的环图
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const segments = this.data.donutSegments;
        const layout = computeDonutLayout(w, h, 1, true);

        // 命中判定要用同一份布局与画布偏移
        (this as any)._donutLayout = layout;
        (this as any)._donutRect = {
          left: (info && info.left) || 0,
          top: (info && info.top) || 0
        };

        if (!segments.length) {
          ctx.clearRect(0, 0, w, h);
          return;
        }

        // 中心金额按实际测量宽度缩字号：内圈直径有限，
        // 金额到 10 万以上就会压到色环上。用 measureText 覆盖任意位数。
        const maxTextW = layout.innerR * 2 - 6;
        const centerText = `¥${this.data.yearTotalText}`;
        ctx.font = 'bold 14px sans-serif';
        const measured = ctx.measureText(centerText).width;
        const fontScale = measured > maxTextW ? Math.max(0.55, maxTextW / measured) : 1;

        const intPercents: number[] = (this as any)._intPercents || [];

        renderDonut({
          ctx,
          w,
          h,
          segments,
          total: this.data.yearTotalText,
          activeIndex: this.data.donutActive,
          showLabels: true,
          centerLabel: '今年合计',
          fontScale,
          // 标签用整数百分比：两位小数太长，会挤到相邻标签
          labelFormatter: (seg, i) =>
            `${seg.name} ${typeof intPercents[i] === 'number' ? intPercents[i] : Math.round(seg.percent)}%`
        });
      });
  },

  /** 点环图扇区：选中 / 取消选中 */
  onTapDonut(e: WechatMiniprogram.TouchEvent) {
    const lay: any = (this as any)._donutLayout;
    const rect: any = (this as any)._donutRect;
    if (!lay) return;

    const src: any =
      (e.touches && e.touches[0]) ||
      (e.changedTouches && e.changedTouches[0]) ||
      (e as any).detail;
    if (!src) return;

    const p = toCanvasPoint(src, rect || { left: 0, top: 0 });
    if (!p) return;

    const segs = this.data.donutSegments;
    if (!segs.length) return;

    const hit = hitDonutSegment(
      p.x,
      p.y,
      lay.cx,
      lay.cy,
      lay.innerR,
      lay.outerR,
      segs.map(s => s.percent),
      this.data.donutActive,
      lay.offR
    );

    this.selectDonut(this.data.donutActive === hit ? -1 : hit);
  },

  /** 点图例行：与点扇区等效，方便手指点不到细扇区时使用 */
  onTapLegend(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (isNaN(index)) return;
    const list = this.data.carCosts;
    if (index < 0 || index >= list.length) return;

    const segIndex = list[index].segIndex;
    if (typeof segIndex !== 'number' || segIndex < 0) return; // 该车本年无支出，无扇区可选中

    this.selectDonut(this.data.donutActive === segIndex ? -1 : segIndex);
  },

  selectDonut(index: number) {
    this.setData({ donutActive: index }, () => this.drawDonut());
  },

  /** 点「数据总览」卡片 → 全车汇总页（默认本年） */
  onOpenSummary() {
    wx.navigateTo({ url: '/pages/summary/index?rangeType=year' });
  },

  /**
   * 保养状态环图数据：超期 / 临近 / 正常 三种状态的项数占比。
   *
   * 不在页面上逐条列保养项——多车时列不下，而且用户要的是「有没有要处理的」。
   * 明细交给「全车保养」页（pages/maintain-all）。
   */
  buildMaintainRing(storage: ReturnType<typeof getStorage>, now: number) {
    const cars = listCars(storage);
    const batch = getMaintainProgressBatch(
      storage,
      cars.map(c => c.sourceId),
      now
    );

    let bad = 0;
    let warn = 0;
    let ok = 0;
    for (const id of Object.keys(batch)) {
      for (const it of batch[id]) {
        if (isRemainOverdue(it.remainMileage, it.remainDays)) bad++;
        else if (it.urgent) warn++;
        else ok++;
      }
    }
    const total = bad + warn + ok;

    // 百分比合计必须正好 100：最后一段吃掉四舍五入的误差
    const raw = [bad, warn, ok];
    const percents = raw.map(n => (total > 0 ? Math.round((n / total) * 100) : 0));
    const diff = total > 0 ? 100 - percents.reduce((s, n) => s + n, 0) : 0;
    if (total > 0) percents[percents.length - 1] += diff;

    const defs = [
      { name: '已超期', count: bad, color: '#F5474F' },
      { name: '临近到期', count: warn, color: '#E8912A' },
      { name: '正常', count: ok, color: '#B6BCC8' }
    ];

    const segments = defs
      .map((d, i) => ({ name: d.name, amount: `${d.count} 项`, percent: percents[i], color: d.color }))
      // 0 项的段不画，否则环上会出现一条看不见却占角度的缝
      .filter((s, i) => defs[i].count > 0);

    return {
      mntSegments: segments,
      mntTotalText: total > 0 ? `${bad} / ${total}` : '0 / 0',
      mntBad: bad,
      mntWarn: warn,
      mntOk: ok,
      mntTotal: total
    };
  },

  /** 保养卡整块可点 → 全车保养页（所有车的临期与超期） */
  onOpenMaintainAll() {
    wx.navigateTo({ url: '/pages/maintain-all/index' });
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
});
