"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHART_COLORS = void 0;
exports.resolveRange = resolveRange;
exports.buildStats = buildStats;
const number_1 = require("../utils/number");
const date_1 = require("../utils/date");
const fuel_service_1 = require("./fuel.service");
/**
 * 分类支出 / 按车花费的配色（设计报告 6.1）。
 *
 * 10 色：超过 6 辆车时不再出现「第 7 辆与第 1 辆同色」。
 * 色相分布刻意拉开（蓝/绿/橙/红/紫/青/粉/靛/棕/黄绿），
 * 保证相邻两项在白底上也能区分。
 *
 * 与 app.wxss 的 --chart-1..--chart-10 必须一一对应（tests/chart-colors.test.ts 有断言）。
 */
exports.CHART_COLORS = [
    '#3B82F6', // 1 蓝
    '#22C55E', // 2 绿
    '#F59E0B', // 3 橙
    '#EF4444', // 4 红
    '#A855F7', // 5 紫
    '#14B8A6', // 6 青
    '#EC4899', // 7 粉
    '#6366F1', // 8 靛
    '#78716C', // 9 棕灰
    '#84CC16' // 10 黄绿
];
function endOfDay(d) {
    const t = new Date(d);
    t.setHours(23, 59, 59, 999);
    return t.getTime();
}
/** 解析维度为 [start, end] 时间区间（本地时区） */
function resolveRange(range) {
    if (range.type === 'all') {
        return { start: 0, end: Number.MAX_SAFE_INTEGER };
    }
    if (range.type === 'year') {
        const start = new Date(range.year, 0, 1).getTime();
        const end = endOfDay(new Date(range.year, 11, 31));
        return { start, end };
    }
    const start = new Date(range.year, range.month - 1, 1).getTime();
    const end = endOfDay(new Date(range.year, range.month, 0));
    return { start, end };
}
/**
 * 按本地月份聚合 value 序列（BR-23：无数据月份不补零）。
 * 跨度跨年时标签带年份，否则「全部」范围会把 2025/7 与 2026/7 合并成一个点。
 */
function groupByMonth(list, dateOf, valueOf) {
    const years = new Set(list.map(x => new Date(dateOf(x)).getFullYear()));
    const crossYear = years.size > 1;
    // 记下每个月份标签对应的最早时间戳，最后按它排序。
    // 不能依赖「首次出现顺序」——入参可能是降序（listCosts 就是按 costDate 降序），
    // 那样柱状图会变成最新→最旧，与「月度行程」的升序方向相反。
    const map = new Map();
    for (const x of list) {
        const ts = dateOf(x);
        const label = crossYear ? (0, date_1.monthLabelWithYear)(ts) : (0, date_1.monthLabel)(ts);
        const hit = map.get(label);
        if (hit) {
            hit.value += valueOf(x);
            if (ts < hit.firstTs)
                hit.firstTs = ts;
        }
        else {
            map.set(label, { value: valueOf(x), firstTs: ts });
        }
    }
    return [...map.entries()]
        .sort((a, b) => a[1].firstTs - b[1].firstTs)
        .map(([label, agg]) => ({ label, value: (0, number_1.round2)(agg.value) }));
}
/**
 * 一次筛选、一次遍历产出全部指标（设计报告 7.6）。
 * 入参为软删除过滤后的现存数据。
 */
function buildStats(range, costs, refuels, consumptions, categories, car) {
    var _a;
    const { start, end } = resolveRange(range);
    const inRange = (t) => t >= start && t <= end;
    const costList = costs.filter(c => inRange(c.costDate));
    const fuelList = refuels
        .filter(r => inRange(r.fuelDate))
        .sort((a, b) => a.fuelDate - b.fuelDate);
    const segList = consumptions
        .filter(c => inRange(c.endDate))
        .sort((a, b) => a.endDate - b.endDate);
    // ---------- 里程 ----------
    // 用 maxOf/minOf 而不是 Math.max(...)：记录上万条时展开成实参会栈溢出，
    // 且一条 NaN 就会让最大值变成 NaN（里程显示 --）
    const latest = (0, number_1.maxOf)(fuelList.map(r => r.makeMileages), car.mileages);
    const mileages = fuelList.map(r => r.makeMileages);
    const increased = mileages.length > 1 ? (0, number_1.maxOf)(mileages) - (0, number_1.minOf)(mileages) : 0;
    // R-07：加油与充电记录 / 区间分开统计，避免把 L 与 kWh 混加
    const isEv = (e) => e.energyType === 'ev';
    const fuelOnlyList = fuelList.filter(r => !isEv(r));
    const evList = fuelList.filter(isEv);
    const fuelSegList = segList.filter(c => !isEv(c));
    const evSegList = segList.filter(isEv);
    const fuelMileage = fuelSegList.reduce((s, c) => s + c.mileage, 0);
    const evMileage = evSegList.reduce((s, c) => s + c.mileage, 0);
    // 趋势图与月度行程按车辆主口径选一组，保证单位一致
    const primarySegs = car.energyType === 'ev' ? evSegList : fuelSegList;
    // ---------- 油耗 / 电耗 / 支出 ----------
    const totalFuelCost = (0, number_1.round2)(fuelOnlyList.reduce((s, r) => s + r.actualPayAmount, 0));
    const totalChargeCost = (0, number_1.round2)(evList.reduce((s, r) => s + r.actualPayAmount, 0));
    const sumFuelAmount = fuelSegList.reduce((s, c) => s + c.fuelAmount, 0);
    const sumChargeEnergy = evSegList.reduce((s, c) => s + c.fuelAmount, 0);
    const totalCost = (0, number_1.round2)(costList.reduce((s, c) => s + c.amount, 0));
    const avgConsumption = fuelMileage > 0
        ? (0, fuel_service_1.clampFuelConsumption)((sumFuelAmount / fuelMileage) * 100)
        : 0;
    // 电耗上限独立于油耗：冬季高电耗车型可达 33 kWh/100km，
    // 套用油耗的 30 上限会把真实值截断，让用户误以为电耗改善了
    const evAvgConsumption = evMileage > 0
        ? Math.min(fuel_service_1.MAX_EV_CONSUMPTION, (sumChargeEnergy / evMileage) * 100)
        : 0;
    const fuelCostPerKm = fuelMileage > 0 ? totalFuelCost / fuelMileage : 0;
    const chargeCostPerKm = evMileage > 0 ? totalChargeCost / evMileage : 0;
    const expensePerKm = increased > 0 ? totalCost / increased : 0;
    // 分子可能为负（油费来自加油记录，而关联 cost 可能未计入 totalCost），
    // 负的「除掉油费」无意义，钳到 0
    const exEnergy = totalCost - totalFuelCost - totalChargeCost;
    const expensePerKmExFuel = increased > 0 ? Math.max(0, exEnergy) / increased : 0;
    // ---------- 分类支出（降序 + 最大余数补齐 100%） ----------
    const byCategory = new Map();
    for (const c of costList) {
        byCategory.set(c.categorySourceId, ((_a = byCategory.get(c.categorySourceId)) !== null && _a !== void 0 ? _a : 0) + c.amount);
    }
    const named = [...byCategory.entries()]
        .map(([id, amount]) => {
        var _a, _b;
        return ({
            categorySourceId: id,
            name: (_b = (_a = categories.find(x => x.sourceId === id)) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '其他',
            amount: (0, number_1.round2)(amount),
            percent: totalCost > 0 ? (0, number_1.round2)((amount / totalCost) * 100) : 0,
            color: ''
        });
    })
        .sort((a, b) => b.amount - a.amount);
    if (named.length && totalCost > 0) {
        const diff = (0, number_1.round2)(100 - named.reduce((s, x) => s + x.percent, 0));
        named[0].percent = (0, number_1.round2)(named[0].percent + diff);
    }
    const categoriesOut = named.map((x, i) => (Object.assign(Object.assign({}, x), { color: exports.CHART_COLORS[i % exports.CHART_COLORS.length] })));
    // ---------- 月度聚合（BR-23） ----------
    const monthlyMileage = groupByMonth(primarySegs, c => c.endDate, c => c.mileage);
    const monthlyCost = groupByMonth(costList, c => c.costDate, c => c.amount);
    return {
        mileage: { latest, increased, fuelMileage, evMileage },
        fuel: { totalCost: totalFuelCost, avgConsumption: (0, number_1.round2)(avgConsumption), costPerKm: (0, number_1.round3)(fuelCostPerKm) },
        electricity: {
            totalCost: totalChargeCost,
            energy: (0, number_1.round2)(sumChargeEnergy),
            mileage: evMileage,
            avgConsumption: (0, number_1.round2)(evAvgConsumption),
            costPerKm: (0, number_1.round3)(chargeCostPerKm)
        },
        expense: { total: totalCost, perKm: (0, number_1.round3)(expensePerKm), perKmExFuel: (0, number_1.round3)(expensePerKmExFuel) },
        categories: categoriesOut,
        consumptionTrend: primarySegs.map(c => ({ date: c.endDate, value: (0, number_1.round2)(c.fuelConsumption), mileage: c.mileage })),
        monthlyMileage,
        monthlyCost
    };
}
