// 原子接口：查询养车花费与能耗统计
//
// 三种作用域，按用户意图自动判断：
//   ① 说了车名            → 那一辆车
//   ② 没说车名 + 只有一辆  → 那一辆车
//   ③ 没说车名 + 多辆车    → **全部车辆合计 + 每车明细**
//
// ③ 是最容易被做错的：「今年养车花了多少」问的是家底，只答一辆会误导用户。
// 口径仍完全复用主包 domain/stats.service（镜像在 ../lib），不在这里重写公式。
import { buildStats, StatsRange } from '../lib/domain/stats.service';
import { Car } from '../lib/types/models';
import {
  energyLabel,
  readCars,
  readCategories,
  readConsumptions,
  readCosts,
  readRefuels,
  resolveCarStrict
} from '../lib/store';

interface Args {
  /** 车辆名称，可不传；不传且有多辆车时返回全部车辆合计 */
  carName?: string;
  /** 统计维度：year（默认）/ month / all / custom */
  rangeType?: 'year' | 'month' | 'all' | 'custom';
  year?: number;
  month?: number;
  /** 自定义区间起点 YYYY-MM-DD（rangeType=custom 时必填） */
  startDate?: string;
  /** 自定义区间终点 YYYY-MM-DD（rangeType=custom 时必填） */
  endDate?: string;
}

function rangeLabel(range: StatsRange): string {
  if (range.type === 'all') return '全部时间';
  if (range.type === 'year') return `${range.year} 年`;
  if (range.type === 'custom') return `${ymd(range.start)} 至 ${ymd(range.end)}`;
  return `${range.year} 年 ${range.month} 月`;
}

/** 时间戳 → YYYY-MM-DD */
function ymd(ts: number): string {
  const d = new Date(ts);
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** YYYY-MM-DD → 当天 00:00 的时间戳；解析不出来返回 null */
function parseYmd(text: string | undefined): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((text || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * 数据总览页的 query。
 *
 * 页面靠它还原「用户问的是哪个区间」——不带参数就只能显示默认的本年，
 * 于是出现「问某月却显示全年」。参数值都不含特殊字符，无需 encode。
 */
function summaryQuery(range: StatsRange): string {
  if (range.type === 'all') return 'rangeType=all';
  if (range.type === 'year') return `rangeType=year&year=${range.year}`;
  if (range.type === 'custom') return `rangeType=custom&start=${ymd(range.start)}&end=${ymd(range.end)}`;
  return `rangeType=month&year=${range.year}&month=${range.month}`;
}

/** 单车统计页的 query（页面 own 的参数名是 range/year/month/custom） */
function carStatsQuery(range: StatsRange): string {
  if (range.type === 'all') return 'range=all';
  if (range.type === 'year') return `range=year&year=${range.year}`;
  if (range.type === 'custom') return `range=custom&start=${ymd(range.start)}&end=${ymd(range.end)}`;
  return `range=month&year=${range.year}&month=${range.month}`;
}

/** 单辆车的快照（口径与统计页完全一致） */
function snapshotOf(car: Car, range: StatsRange) {
  const costs = readCosts().filter(c => c.carSourceId === car.sourceId);
  const refuels = readRefuels().filter(r => r.carSourceId === car.sourceId);
  const segs = readConsumptions().filter(s => s.carSourceId === car.sourceId);
  return buildStats(range, costs, refuels, segs, readCategories(), car);
}

export async function queryStats(args: Args = {}): Promise<AgentApiResult> {
  const cars = readCars();
  if (!cars.length) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: '用户还没有添加任何车辆，无法统计。请引导用户在「车辆」页点右上角「＋」添加车辆后再查询。'
        }
      ]
    };
  }

  const now = new Date();
  const type =
    args.rangeType === 'month' || args.rangeType === 'all' || args.rangeType === 'custom'
      ? args.rangeType
      : 'year';

  /**
   * 任意区间：「最近半个月」「国庆那几天」「上周」这类问法没有固定的年月，
   * 只能让模型把口语换算成具体起止日期传进来。
   * 日期缺失或解析失败时退回本年——绝不因为参数问题报错卡死对话。
   */
  let range: StatsRange;
  if (type === 'all') {
    range = { type: 'all' };
  } else if (type === 'custom') {
    const start = parseYmd(args.startDate);
    const end = parseYmd(args.endDate) ?? start;
    range =
      start !== null && end !== null
        ? { type: 'custom', start, end: Math.max(start, end) }
        : { type: 'year', year: args.year || now.getFullYear() };
  } else if (type === 'month') {
    range = { type: 'month', year: args.year || now.getFullYear(), month: args.month || now.getMonth() + 1 };
  } else {
    range = { type: 'year', year: args.year || now.getFullYear() };
  }
  const label = rangeLabel(range);

  const askedName = (args.carName || '').trim();
  /**
   * 全车作用域有两种入口：
   *   ① 没说车名 + 多辆车 → 用户问的是家底；
   *   ② 说了车名但匹配不上 + 多辆车 → 「我两辆车」这类**数量短语**被当成车名传进来时，
   *      报错会让模型反复重试直至 blocked（实测评测就是这么挂的）。
   *      此时回落成全车汇总并说明，既不误导也不会卡死。
   */
  const matched = resolveCarStrict(cars, askedName);
  const isAllScope = !matched.car && cars.length > 1;
  const nameMissNote =
    isAllScope && askedName ? `没有找到叫「${askedName}」的车，下面是全部 ${cars.length} 辆车的合计：` : '';

  // ---------- ③ 全车合计 ----------
  if (isAllScope) {
    const rows = cars.map(car => ({ car, snap: snapshotOf(car, range) }));
    const total = rows.reduce((s, r) => s + r.snap.expense.total, 0);
    const mileage = rows.reduce((s, r) => s + r.snap.mileage.increased, 0);
    // 不含能耗：每辆车各自扣掉自己的油费/电费，再汇总（不能混加 L 与 kWh）
    const exEnergy = rows.reduce(
      (s, r) => s + Math.max(0, r.snap.expense.total - r.snap.fuel.totalCost - r.snap.electricity.totalCost),
      0
    );
    const perKm = mileage > 0 ? total / mileage : 0;
    const perKmExFuel = mileage > 0 ? exEnergy / mileage : 0;

    // 按支出降序，最多列 5 辆，避免长回答
    const ranked = rows.slice().sort((a, b) => b.snap.expense.total - a.snap.expense.total);
    const shown = ranked.slice(0, 5);
    /**
     * 明细里带上每辆车自己的油耗/电耗：
     * 「我的车平均油耗是多少」在**多车**场景下必须分开给（L 与 kWh 不能相加），
     * 否则模型只能挑一辆车回答，就成了「掏出某一辆车的数据」。
     */
    const breakdownText = shown
      .map(r => {
        const isEv = r.car.energyType === 'ev';
        const segMileage = isEv ? r.snap.electricity.mileage : r.snap.mileage.fuelMileage;
        const cons = isEv ? r.snap.electricity.avgConsumption : r.snap.fuel.avgConsumption;
        const consText =
          segMileage > 0
            ? `，${isEv ? '电耗' : '油耗'} ${cons.toFixed(2)} ${isEv ? 'kWh' : 'L'}/100km`
            : '';
        return `${r.car.name} ¥${r.snap.expense.total.toFixed(2)}（${r.snap.expense.perKm.toFixed(3)}/km${consText}）`;
      })
      .join('、');
    const restCount = ranked.length - shown.length;

    // 每公里成本必须把算式摊开：合计支出 ÷ 合计里程 = 每公里，不能只甩一个结果
    const perKmPart =
      mileage > 0
        ? `合计支出 ¥${total.toFixed(2)} ÷ 有效里程 ${mileage} km = 每公里 ¥${perKm.toFixed(3)}` +
          `（不含能耗 ¥${perKmExFuel.toFixed(3)}）`
        : `合计支出 ¥${total.toFixed(2)}；区间内没有里程记录，暂时算不出每公里成本`;

    const text =
      nameMissNote +
      `${cars.length} 辆车 ${label}：${perKmPart}。` +
      `各车明细：${breakdownText}${restCount > 0 ? ` 等 ${ranked.length} 辆` : ''}。` +
      `需要看某一辆的完整统计，告诉我车名即可。`;

    return {
      isError: false,
      content: [{ type: 'text', text }],
      structuredContent: {
        scope: 'all',
        carCount: String(cars.length),
        rangeLabel: label,
        totalExpense: total.toFixed(2),
        perKm: perKm.toFixed(3),
        perKmExFuel: perKmExFuel.toFixed(3),
        mileageIncreased: String(mileage),
        breakdown: breakdownText,
        // 数据总览是普通页，正文蓝链与接力都能带参数
        pagePath: `pages/summary/index?${summaryQuery(range)}`,
        linkText: '查看数据总览'
      },
      /**
       * 页面接力：全车汇总落到**数据总览页**（普通页），并把区间参数带过去。
       * 落到概览（tabBar）会被 switchTab 丢掉 query，页面永远显示「今年」——
       * 这正是上一轮「问某月却显示全年」的根因。
       */
      handoff: () => ({
        query: summaryQuery(range),
        payload: {
          scope: 'all',
          totalExpense: total.toFixed(2),
          perKm: perKm.toFixed(3),
          carCount: cars.length
        }
      })
      };
  }

  // ---------- ①② 单辆车 ----------
  // 只有一辆车时不做回落：「问的是别的车」与「只有这一辆」是两件事，报错并列车名更诚实
  const { car } = matched;
  if (!car) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有找到名为「${args.carName}」的车辆。现有车辆：${cars.map(c => c.name).join('、')}。请让用户确认是哪一辆后重试。`
        }
      ]
    };
  }

  const snap = snapshotOf(car, range);
  const isEv = car.energyType === 'ev';

  const total = snap.expense.total.toFixed(2);
  const perKm = snap.expense.perKm.toFixed(3);
  const perKmExFuel = snap.expense.perKmExFuel.toFixed(3);
  const energyName = isEv ? '电耗' : '油耗';
  const energyCostLabel = isEv ? '电费' : '油费';
  const consumption = isEv ? snap.electricity.avgConsumption : snap.fuel.avgConsumption;
  const energyCost = (isEv ? snap.electricity.totalCost : snap.fuel.totalCost).toFixed(2);
  /**
   * 能耗的分母是「区间里程」，不是「有效里程 increased」。
   *
   * 两者在首尾区间有缺口时并不相等；文案必须用它自己的分母，
   * 否则用户按「电耗 × 有效里程」反推总电量会对不上账。
   */
  const consumptionMileage = isEv ? snap.electricity.mileage : snap.mileage.fuelMileage;

  const consumptionPart =
    consumptionMileage > 0
      ? `平均${energyName} ${consumption.toFixed(2)} ${isEv ? 'kWh/100km' : 'L/100km'}` +
        `（按 ${consumptionMileage} km ${isEv ? '充电' : '加油'}区间计）`
      : `暂无有效${energyName}区间（需要连续两次${isEv ? '充电' : '加满'}记录）`;

  // 没有能耗记录时不写「其中油费 ¥0.00」这种废话
  const costPart =
    Number(energyCost) > 0
      ? `支出 ¥${total}，其中${energyCostLabel} ¥${energyCost}；`
      : `支出 ¥${total}；`;

  /**
   * 分类明细：主包 stats 里本来就算好了（categories 带金额与占比），
   * 之前没往外传，导致「洗车总共花了多少」这类问题只能答「没有接口」。
   * 只列前 3 类，避免回复过长；完整明细指向统计页。
   */
  const topCategories = snap.categories.slice(0, 3);
  const categoryText = topCategories.length
    ? `；分类上 ${topCategories.map(c => `${c.name} ¥${c.amount.toFixed(2)}`).join('、')}`
    : '';

  // 每公里成本摊开算式；里程为 0 时不要输出「每公里 ¥0.000」——那是误导，不是省钱
  const perKmPart =
    snap.mileage.increased > 0
      ? `支出 ¥${total} ÷ 有效里程 ${snap.mileage.increased} km = 每公里 ¥${perKm}` +
        `（不含${energyCostLabel} ¥${perKmExFuel}）；`
      : '区间内没有里程记录，暂时算不出每公里成本；';

  const text =
    `${car.name}（${energyLabel(car)}）${label}${costPart}` +
    perKmPart +
    `${consumptionPart}，总有效里程 ${snap.mileage.increased} km` +
    `${categoryText}。`;

  return {
    isError: false,
    content: [{ type: 'text', text }],
    structuredContent: {
      scope: 'car',
      carName: car.name,
      energyType: energyLabel(car),
      rangeLabel: label,
      totalExpense: total,
      perKm,
      perKmExFuel,
      energyCost,
      energyCostLabel,
      avgConsumption: consumption.toFixed(2),
      consumptionUnit: isEv ? 'kWh/100km' : 'L/100km',
      consumptionMileage: String(consumptionMileage),
      mileageIncreased: String(snap.mileage.increased),
      categories: topCategories.map(c => ({
        name: c.name,
        amount: c.amount.toFixed(2),
        percent: String(c.percent)
      })),
      pagePath: `pages/statistics/index?id=${car.sourceId}&${carStatsQuery(range)}`,
      linkText: '查看统计详情'
    },
    /** 页面接力：把对话流程整段接到这辆车的统计页 */
    handoff: () => ({
      query: `id=${encodeURIComponent(car.sourceId)}&${carStatsQuery(range)}`,
      payload: {
        scope: 'car',
        carName: car.name,
        totalExpense: total,
        perKm,
        perKmExFuel,
        avgConsumption: consumption.toFixed(2),
        mileageIncreased: String(snap.mileage.increased)
      }
    })
  };
}
