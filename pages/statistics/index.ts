// 统计看板（对齐设计报告 5.10）
import { getStorage } from '../../store/index';
import { getCar } from '../../services/car.service';
import { listCosts, listCategories } from '../../services/cost.service';
import { listRefuels } from '../../services/refuel.service';
import { rebuildConsumptionsGrouped } from '../../domain/fuel.service';
import { buildStats, StatsRange, TREND_GRANULARITY_LABEL } from '../../domain/stats.service';
import { minOf } from '../../utils/number';
import {
  buildShareCardModel,
  computeShareCardLayout,
  formatRangeLabel,
  ShareMode,
  ShareStyle,
  ShareCardInput
} from '../../utils/share-card';
import {
  drawShareCard,
  drawEmptyCard,
  resolveExportDpr,
  EMPTY_CARD_HEIGHT
} from '../../utils/share-card-draw';
import { formatDate } from '../../utils/date';
import { buildShareMessage, buildTimelineMessage, enableShareMenu } from '../../utils/share';
import { safeBack } from '../../utils/safe-back';
import { resolveAgentParams } from '../../utils/agent-handoff';

/**
 * 分享选项：风格 × 模式共六种。
 *
 * 一次 ActionSheet 展示完，避免「先选模式再选风格」的两段式弹窗；
 * 微信 ActionSheet 最多 6 项，正好够用。
 */
const SHARE_OPTIONS: Array<{ label: string; mode: ShareMode; style: ShareStyle }> = [
  { label: '极简线稿 · 精简', mode: 'brief', style: 'a' },
  { label: '极简线稿 · 详细', mode: 'full', style: 'a' },
  { label: '杂志封面 · 精简', mode: 'brief', style: 'b' },
  { label: '杂志封面 · 详细', mode: 'full', style: 'b' },
  { label: '深色运动 · 精简', mode: 'brief', style: 'c' },
  { label: '深色运动 · 详细', mode: 'full', style: 'c' }
];

interface CatView {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

Page({
  data: {
    carId: '',
    /** 车名，供分享标题使用 */
    carName: '',
    rangeType: 'all',
    hasData: false,
    year: 0,
    /** 年份选择器的高亮索引，避免写死 0 导致切年后高亮仍停在首项 */
    yearIndex: 0,
    month: 1,
    years: [] as number[],
    months: Array.from({ length: 12 }, (_, i) => i + 1) as number[],
    // 里程（整数）
    mileageLatest: 0,
    mileageIncreased: 0,
    mileageFuel: 0,
    // 油耗
    fuelTotalCost: '--',
    fuelAvgConsumption: '--',
    fuelCostPerKm: '--',
    // 电耗（R-07）
    isEvCar: false,
    isHybridCar: false,
    chargeTotalCost: '--',
    chargeAvgConsumption: '--',
    chargeCostPerKm: '--',
    trendUnit: 'L/100km',
    mileageLabel: '加油里程 (km)',
    // 支出
    expenseTotal: '--',
    expensePerKm: '--',
    expensePerKmExFuel: '--',
    categories: [] as CatView[],
    /** 环图当前选中分类，-1 表示未选中（与下方图例行双向联动） */
    catActive: -1,
    trend: [] as Array<{ label: string; value: number }>,
    monthlyMileage: [] as Array<{ label: string; value: number }>,
    monthlyCost: [] as Array<{ label: string; value: number }>,
    /** 图表粒度中文名：年→月、月→日、全部→年 */
    granLabel: '月',
    /** 分享进行中，防止重复点击 */
    sharing: false
  },
  onLoad(options: Record<string, string>) {
    const now = new Date();
    // 三层兜底：URL → handoff.query → handoff.payload（query 不保证送达）
    const { params: q, fromAgent } = resolveAgentParams(this, options);

    // 页面只有 月/年/全部 三个维度；任意区间按「同月→月、否则→年」就近还原
    let rangeType = q.range === 'year' ? 'year' : q.range === 'month' ? 'month' : 'all';
    let year = Number(q.year) || now.getFullYear();
    let month = Number(q.month) || now.getMonth() + 1;

    if (q.range === 'custom' || q.rangeType === 'custom') {
      const s = new Date(q.start || '');
      const e = new Date(q.end || '');
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        const sameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
        rangeType = sameMonth ? 'month' : 'year';
        year = s.getFullYear();
        month = s.getMonth() + 1;
      }
    }

    this.setData({
      // handoff 的 query 由开发者 encode，平台不会自动 decode，这里必须自己解
      carId: q.id ? decodeURIComponent(q.id) : '',
      rangeType,
      year,
      month,
      fromAgent
    });
  },
  onShow() {
    this.load();
    enableShareMenu();
  },

  /**
   * 右上角「…」文字转发。
   * 落地页必须是车辆列表：统计页依赖 carId，接收方本地无此车会直接 navigateBack。
   * 需要分享具体数据时走「生成统计图片」。
   */
  onShareAppMessage() {
    const car = this.data.carName ? `我的${this.data.carName}` : '';
    return buildShareMessage({
      highlight: car ? `${car} · ${this.shareRangeLabel()}` : ''
    });
  },

  onShareTimeline() {
    const car = this.data.carName ? `我的${this.data.carName}` : '';
    return buildTimelineMessage({
      highlight: car ? `${car} · ${this.shareRangeLabel()}` : ''
    });
  },

  /** 当前统计维度文案，供分享标题复用 */
  shareRangeLabel(): string {
    return formatRangeLabel(this.buildRange());
  },

  buildRange(): StatsRange {
    const { rangeType, year, month } = this.data;
    if (rangeType === 'year') return { type: 'year', year };
    if (rangeType === 'month') return { type: 'month', year, month };
    return { type: 'all' };
  },
  load() {
    const storage = getStorage();
    const car = getCar(storage, this.data.carId);
    if (!car) {
      wx.showToast({ title: '车辆不存在', icon: 'none' });
      safeBack(this);
      return;
    }

    const costs = listCosts(storage, car.sourceId);
    const refuels = listRefuels(storage, car.sourceId);
    const categories = listCategories(storage);
    const segs = rebuildConsumptionsGrouped([...refuels].sort((a, b) => a.fuelDate - b.fuelDate));

    const nowYear = new Date().getFullYear();
    // 用 minOf 而不是 Math.min(...allYears)：记录上万条时把年份展开成实参会栈溢出；
    // 同时也省掉了一次纯为取最小值而构造的中间数组
    const minYear = Math.min(
      nowYear,
      minOf(costs.map(c => new Date(c.costDate).getFullYear()), nowYear),
      minOf(refuels.map(r => new Date(r.fuelDate).getFullYear()), nowYear)
    );
    const years: number[] = [];
    for (let y = nowYear; y >= minYear; y--) years.push(y);

    const snap = buildStats(this.buildRange(), costs, refuels, segs, categories, car);
    const hasData = costs.length > 0 || refuels.length > 0;
    const isEvCar = car.energyType === 'ev';
    const isHybridCar = car.energyType === 'hybrid';

    this.setData({
      years,
      yearIndex: Math.max(0, years.indexOf(this.data.year)),
      hasData,
      carName: car.name,
      isEvCar,
      isHybridCar,
      chargeTotalCost: snap.electricity.totalCost.toFixed(2),
      chargeAvgConsumption: snap.electricity.avgConsumption.toFixed(2),
      chargeCostPerKm: snap.electricity.costPerKm.toFixed(3),
      trendUnit: isEvCar ? 'kWh/100km' : 'L/100km',
      mileageLabel: isEvCar ? '充电里程 (km)' : '加油里程 (km)',
      mileageLatest: snap.mileage.latest,
      mileageIncreased: snap.mileage.increased,
      // 纯电车取电耗区间里程，否则该列恒为 0（与详情页口径保持一致）
      mileageFuel: isEvCar ? snap.mileage.evMileage : snap.mileage.fuelMileage,
      // 无数据时显示占位符，避免把「没数据」呈现成 0.00
      fuelTotalCost: hasData ? snap.fuel.totalCost.toFixed(2) : '--',
      fuelAvgConsumption: hasData ? snap.fuel.avgConsumption.toFixed(2) : '--',
      fuelCostPerKm: hasData ? snap.fuel.costPerKm.toFixed(3) : '--',
      expenseTotal: hasData ? snap.expense.total.toFixed(2) : '--',
      expensePerKm: hasData ? snap.expense.perKm.toFixed(3) : '--',
      expensePerKmExFuel: hasData ? snap.expense.perKmExFuel.toFixed(3) : '--',
      categories: snap.categories.map(c => ({
        name: c.name,
        amount: c.amount.toFixed(2),
        percent: c.percent,
        color: c.color
      })),
      // 数据换了一批，旧选中的扇区索引可能已不存在
      catActive: -1,
      trend: snap.consumptionTrend.map(t => ({
        label: `${new Date(t.date).getMonth() + 1}/${new Date(t.date).getDate()}`,
        value: t.value
      })),
      // 图表粒度跟随区间：年→月、月→日、全部→年
      monthlyMileage: snap.mileageTrend,
      monthlyCost: snap.costTrend,
      granLabel: TREND_GRANULARITY_LABEL[snap.trendGranularity]
    });
  },
  onRangeChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ rangeType: e.currentTarget.dataset.type as string });
    this.load();
  },

  /**
   * 环图扇区被点击：组件把新索引回传，这里只同步图例高亮。
   *
   * 与概览页的联动逻辑一致——那边是页面自己画 canvas 所以直接 setData，
   * 这边扇区在组件内，必须用事件回传才不会出现「图例和扇区各说各话」。
   */
  onCatChange(e: WechatMiniprogram.CustomEvent) {
    const index = Number((e.detail as any)?.index);
    this.setData({ catActive: isNaN(index) ? -1 : index });
  },

  /** 点图例行：反向驱动扇区突出（手指点不到细扇区时的替代入口） */
  onTapCatRow(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    if (isNaN(index) || index < 0 || index >= this.data.categories.length) return;
    this.setData({ catActive: this.data.catActive === index ? -1 : index });
  },
  onYearChange(e: WechatMiniprogram.PickerChange) {
    const idx = Number(e.detail.value);
    this.setData({ year: this.data.years[idx], yearIndex: idx });
    this.load();
  },
  onMonthChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ month: this.data.months[Number(e.detail.value)] });
    this.load();
  },

  // ---------------- 分享统计卡片 ----------------
  /**
   * 生成统计卡片并唤起分享菜单。
   *
   * 小程序没有「整页截图」能力，canvasToTempFilePath 只能导出 canvas 内容，
   * 所以在页面里的离屏 canvas 上重绘一张卡片，再交给 wx.showShareImageMenu
   * （自带「发送给朋友 / 分享到朋友圈 / 保存到相册」三个入口）。
   */
  /** 第一步：一次选定「风格 + 模式」（六选一，省掉二次弹窗） */
  onShareStatistics() {
    if (this.data.sharing) return;
    const options = SHARE_OPTIONS;
    wx.showActionSheet({
      itemList: options.map(o => o.label),
      success: res => {
        const opt = options[res.tapIndex];
        if (!opt) return;
        this.generateShareImage(opt.mode, opt.style);
      },
      fail: () => {
        // 用户取消，无需提示
      }
    });
  },

  /** 第二步：按风格与模式绘制并唤起分享菜单 */
  generateShareImage(mode: ShareMode, style: ShareStyle) {
    if (this.data.sharing) return;
    this.setData({ sharing: true });
    wx.showLoading({ title: '生成中…', mask: true });

    this.drawShareCard(mode, style)
      .then((filePath: string) => {
        wx.hideLoading();
        this.setData({ sharing: false });
        this.openShareSheet(filePath);
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ sharing: false });
        wx.showToast({ title: '生成图片失败，请重试', icon: 'none' });
      });
  },

  /**
   * 唤起图片分享菜单（发送给朋友 / 分享到朋友圈 / 保存到相册）。
   * showShareImageMenu 需要基础库 2.14.4+；低版本回退为「预览长按保存」。
   */
  openShareSheet(filePath: string) {
    if (typeof wx.showShareImageMenu === 'function') {
      wx.showShareImageMenu({
        path: filePath,
        fail: err => {
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') >= 0) return;
          // 基础库不支持或调用失败时回退到预览
          this.previewAsFallback(filePath);
        }
      });
      return;
    }
    this.previewAsFallback(filePath);
  },

  /** 兜底：预览大图，用户可长按保存或转发 */
  previewAsFallback(filePath: string) {
    wx.previewImage({
      urls: [filePath],
      current: filePath,
      fail: () => wx.showToast({ title: '分享失败，请重试', icon: 'none' })
    });
  },

  /** 组装模型（供绘制与调试复用） */
  buildShareModel(mode: ShareMode, style: ShareStyle) {
    const storage = getStorage();
    const car = getCar(storage, this.data.carId);
    if (!car) return null;

    const costs = listCosts(storage, car.sourceId);
    const refuels = listRefuels(storage, car.sourceId);
    const categories = listCategories(storage);
    const segs = rebuildConsumptionsGrouped([...refuels].sort((a, b) => a.fuelDate - b.fuelDate));
    const range = this.buildRange();
    const snap = buildStats(range, costs, refuels, segs, categories, car);

    const catMap = new Map(categories.map(c => [c.sourceId, c]));
    const input: ShareCardInput = {
      carName: car.name,
      energyType: car.energyType,
      rangeLabel: formatRangeLabel(range),
      hasData: costs.length > 0 || refuels.length > 0,
      mileage: snap.mileage,
      fuel: snap.fuel,
      electricity: snap.electricity,
      expense: {
        total: snap.expense.total,
        perKm: snap.expense.perKm,
        perKmExFuel: snap.expense.perKmExFuel
      },
      categories: snap.categories.map(c => ({
        name: catMap.get(c.categorySourceId)?.name || c.name,
        amount: c.amount,
        percent: c.percent,
        color: c.color
      })),
      trendUnit: car.energyType === 'ev' ? 'kWh/100km' : 'L/100km',
      trend: snap.consumptionTrend.map(t => ({
        label: `${new Date(t.date).getMonth() + 1}/${new Date(t.date).getDate()}`,
        value: t.value
      })),
      // 分享图是静态出图，固定按月即可（页面上的图表才跟随区间切粒度）
      monthlyMileage: snap.monthlyMileage,
      monthlyCost: snap.monthlyCost
    };
    return buildShareCardModel(input, mode, style);
  },

  /** 在离屏 canvas 上绘制并导出临时文件路径 */
  drawShareCard(mode: ShareMode, style: ShareStyle): Promise<string> {
    return new Promise((resolve, reject) => {
      const model = this.buildShareModel(mode, style);
      if (!model) {
        reject(new Error('car not found'));
        return;
      }

      // exec 回调在 Promise executor 返回后才执行，其中若抛错不会被外层 .catch 捕获，
      // 会导致 Promise 永不 settle、sharing 永久为 true、loading 遮罩卡死整页。
      // 因此整段用 try/catch 包住，保证任何异常都能 settle。
      try {
      this.createSelectorQuery()
        .select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec(async (res: any) => {
          try {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error('canvas not found'));
            return;
          }

          const deviceDpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio || 2;
          const layout = computeShareCardLayout(model);
          const height = model.hasData ? layout.height : EMPTY_CARD_HEIGHT;

          // 卡片逻辑高度约 3000px，按 dpr=3 会到 9000px 超出 canvas 上限，
          // 必须按上限反算安全 dpr，否则导出失败或得到空白图
          const dpr = resolveExportDpr(layout.width, height, deviceDpr);

          // 物理像素尺寸必须显式设置，否则导出为空白
          canvas.width = Math.round(layout.width * dpr);
          canvas.height = Math.round(height * dpr);

          const ctx = canvas.getContext('2d');
          // 品牌 Logo：加载失败 / 超时都返回 null，绘制层降级为色块「车」
          const logoImage = await this.loadLogo(canvas);
          const opts = {
            ctx,
            model,
            layout: { ...layout, height },
            dpr,
            footerText: '记录每一公里',
            dateText: formatDate(Date.now()),
            logoImage
          };
          if (model.hasData) {
            drawShareCard(opts);
          } else {
            drawEmptyCard(opts);
          }

          // 注意：设置了 canvas.width/height 后，导出坐标系是**物理像素**。
          // 若 width 传逻辑值（layout.width），取样区只覆盖左上 1/dpr，
          // 结果右侧与底部被裁掉并放大发虚。因此 width/height 必须用物理尺寸。
          const physW = Math.round(layout.width * dpr);
          const physH = Math.round(height * dpr);

          wx.canvasToTempFilePath({
            canvas,
            x: 0,
            y: 0,
            width: physW,
            height: physH,
            destWidth: physW,
            destHeight: physH,
            success: r => resolve(r.tempFilePath),
            fail: () => reject(new Error('export failed'))
          });
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  },

  /**
   * 加载品牌 Logo（绘制层可选项）。
   * 失败 / 超时 / 老基础库不支持都返回 null，让绘制层降级为色块，
   * 绝不能因为一张图卡住整张分享卡的生成。
   */
  loadLogo(canvas: any): Promise<any> {
    return new Promise(resolve => {
      if (!canvas || typeof canvas.createImage !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      const done = (img: any) => {
        if (settled) return;
        settled = true;
        resolve(img);
      };
      // 兜底超时：部分机型 onerror 不触发，避免 Promise 永不 settle
      const timer = setTimeout(() => done(null), 1500);
      try {
        const img = canvas.createImage();
        img.onload = () => {
          clearTimeout(timer);
          done(img);
        };
        img.onerror = () => {
          clearTimeout(timer);
          done(null);
        };
        img.src = '/assets/logo.png';
      } catch (e) {
        clearTimeout(timer);
        done(null);
      }
    });
  }
});
