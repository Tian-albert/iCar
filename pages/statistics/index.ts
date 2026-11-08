// 统计看板（对齐设计报告 5.10）
import { getStorage } from '../../store/index';
import { getCar } from '../../services/car.service';
import { listCosts, listCategories } from '../../services/cost.service';
import { listRefuels } from '../../services/refuel.service';
import { rebuildConsumptionsGrouped } from '../../domain/fuel.service';
import { buildStats, StatsRange } from '../../domain/stats.service';
import {
  buildShareCardModel,
  computeShareCardLayout,
  formatRangeLabel,
  ShareMode,
  ShareCardInput
} from '../../utils/share-card';
import {
  drawShareCard,
  drawEmptyCard,
  resolveExportDpr,
  EMPTY_CARD_HEIGHT
} from '../../utils/share-card-draw';
import { formatDate } from '../../utils/date';

interface CatView {
  name: string;
  amount: string;
  percent: number;
  color: string;
}

Page({
  data: {
    carId: '',
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
    hasCharge: false,
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
    trend: [] as Array<{ label: string; value: number }>,
    monthlyMileage: [] as Array<{ label: string; value: number }>,
    monthlyCost: [] as Array<{ label: string; value: number }>,
    /** 分享进行中，防止重复点击 */
    sharing: false
  },
  onLoad(options: Record<string, string>) {
    const now = new Date();
    this.setData({
      carId: options.id,
      // 从车辆详情「今年统计」进入时默认展示年维度
      rangeType: options.range === 'year' ? 'year' : 'all',
      year: now.getFullYear(),
      month: now.getMonth() + 1
    });
  },
  onShow() {
    this.load();
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
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }

    const costs = listCosts(storage, car.sourceId);
    const refuels = listRefuels(storage, car.sourceId);
    const categories = listCategories(storage);
    const segs = rebuildConsumptionsGrouped([...refuels].sort((a, b) => a.fuelDate - b.fuelDate));

    const nowYear = new Date().getFullYear();
    const allYears = [
      nowYear,
      ...costs.map(c => new Date(c.costDate).getFullYear()),
      ...refuels.map(r => new Date(r.fuelDate).getFullYear())
    ];
    const minYear = Math.min(...allYears);
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
      isEvCar,
      isHybridCar,
      hasCharge: snap.electricity.mileage > 0 || snap.electricity.totalCost > 0,
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
      trend: snap.consumptionTrend.map(t => ({
        label: `${new Date(t.date).getMonth() + 1}/${new Date(t.date).getDate()}`,
        value: t.value
      })),
      monthlyMileage: snap.monthlyMileage.map(m => ({ label: m.label, value: m.value })),
      monthlyCost: snap.monthlyCost.map(m => ({ label: m.label, value: m.value }))
    });
  },
  onRangeChange(e: WechatMiniprogram.TouchEvent) {
    this.setData({ rangeType: e.currentTarget.dataset.type as string });
    this.load();
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
  /** 第一步：选择精简 / 详细模式 */
  onShareStatistics() {
    if (this.data.sharing) return;
    wx.showActionSheet({
      itemList: ['精简模式（指标卡 + 环形图）', '详细模式（完整统计页）'],
      success: res => {
        const mode: ShareMode = res.tapIndex === 1 ? 'full' : 'brief';
        this.generateShareImage(mode);
      },
      fail: () => {
        // 用户取消，无需提示
      }
    });
  },

  /** 第二步：按模式绘制并唤起分享菜单 */
  generateShareImage(mode: ShareMode) {
    if (this.data.sharing) return;
    this.setData({ sharing: true });
    wx.showLoading({ title: '生成中…', mask: true });

    this.drawShareCard(mode)
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
  buildShareModel(mode: ShareMode = 'full') {
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
      monthlyMileage: snap.monthlyMileage.map(m => ({ label: m.label, value: m.value })),
      monthlyCost: snap.monthlyCost.map(m => ({ label: m.label, value: m.value }))
    };
    return buildShareCardModel(input, mode);
  },

  /** 在离屏 canvas 上绘制并导出临时文件路径 */
  drawShareCard(mode: ShareMode = 'full'): Promise<string> {
    return new Promise((resolve, reject) => {
      const model = this.buildShareModel(mode);
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
        .exec((res: any) => {
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
          const opts = {
            ctx,
            model,
            layout: { ...layout, height },
            dpr,
            footerText: '车记本 · 记录每一公里',
            dateText: formatDate(Date.now())
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
  }
});
