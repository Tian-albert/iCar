"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryStats = queryStats;
// 原子接口：查询养车花费与能耗统计
//
// 三种作用域，按用户意图自动判断：
//   ① 说了车名            → 那一辆车
//   ② 没说车名 + 只有一辆  → 那一辆车
//   ③ 没说车名 + 多辆车    → **全部车辆合计 + 每车明细**
//
// ③ 是最容易被做错的：「今年养车花了多少」问的是家底，只答一辆会误导用户。
// 口径仍完全复用主包 domain/stats.service（镜像在 ../lib），不在这里重写公式。
const stats_service_1 = require("../lib/domain/stats.service");
const store_1 = require("../lib/store");
function rangeLabel(range) {
    if (range.type === 'all')
        return '全部时间';
    if (range.type === 'year')
        return `${range.year} 年`;
    return `${range.year} 年 ${range.month} 月`;
}
/** 单辆车的快照（口径与统计页完全一致） */
function snapshotOf(car, range) {
    const costs = (0, store_1.readCosts)().filter(c => c.carSourceId === car.sourceId);
    const refuels = (0, store_1.readRefuels)().filter(r => r.carSourceId === car.sourceId);
    const segs = (0, store_1.readConsumptions)().filter(s => s.carSourceId === car.sourceId);
    return (0, stats_service_1.buildStats)(range, costs, refuels, segs, (0, store_1.readCategories)(), car);
}
async function queryStats(args = {}) {
    const cars = (0, store_1.readCars)();
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
    const type = args.rangeType === 'month' || args.rangeType === 'all' ? args.rangeType : 'year';
    const range = type === 'all'
        ? { type: 'all' }
        : type === 'month'
            ? { type: 'month', year: args.year || now.getFullYear(), month: args.month || now.getMonth() + 1 }
            : { type: 'year', year: args.year || now.getFullYear() };
    const label = rangeLabel(range);
    const askedName = (args.carName || '').trim();
    const isAllScope = !askedName && cars.length > 1;
    // ---------- ③ 全车合计 ----------
    if (isAllScope) {
        const rows = cars.map(car => ({ car, snap: snapshotOf(car, range) }));
        const total = rows.reduce((s, r) => s + r.snap.expense.total, 0);
        const mileage = rows.reduce((s, r) => s + r.snap.mileage.increased, 0);
        // 不含能耗：每辆车各自扣掉自己的油费/电费，再汇总（不能混加 L 与 kWh）
        const exEnergy = rows.reduce((s, r) => s + Math.max(0, r.snap.expense.total - r.snap.fuel.totalCost - r.snap.electricity.totalCost), 0);
        const perKm = mileage > 0 ? total / mileage : 0;
        const perKmExFuel = mileage > 0 ? exEnergy / mileage : 0;
        // 按支出降序，最多列 5 辆，避免长回答
        const ranked = rows.slice().sort((a, b) => b.snap.expense.total - a.snap.expense.total);
        const shown = ranked.slice(0, 5);
        const breakdownText = shown
            .map(r => `${r.car.name} ¥${r.snap.expense.total.toFixed(2)}（${r.snap.expense.perKm.toFixed(3)}/km）`)
            .join('、');
        const restCount = ranked.length - shown.length;
        const text = `${cars.length} 辆车 ${label}合计支出 ¥${total.toFixed(2)}，每公里 ¥${perKm.toFixed(3)}` +
            `（不含能耗 ¥${perKmExFuel.toFixed(3)}）；其中 ${breakdownText}` +
            `${restCount > 0 ? ` 等 ${ranked.length} 辆` : ''}。` +
            `需要看某一辆的油耗/电耗明细，告诉我车名即可。`;
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
                pagePath: 'pages/statistics/index',
                linkText: '查看统计详情'
            }
        };
    }
    // ---------- ①② 单辆车 ----------
    // 说了车名就必须匹配上：用户问「老婆的车」而库里没有，答成 CRV 的数字是误导
    const { car } = (0, store_1.resolveCarStrict)(cars, askedName);
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
    const consumptionPart = consumptionMileage > 0
        ? `平均${energyName} ${consumption.toFixed(2)} ${isEv ? 'kWh/100km' : 'L/100km'}` +
            `（按 ${consumptionMileage} km ${isEv ? '充电' : '加油'}区间计）`
        : `暂无有效${energyName}区间（需要连续两次${isEv ? '充电' : '加满'}记录）`;
    // 没有能耗记录时不写「其中油费 ¥0.00」这种废话
    const costPart = Number(energyCost) > 0
        ? `支出 ¥${total}，其中${energyCostLabel} ¥${energyCost}；`
        : `支出 ¥${total}；`;
    const text = `${car.name}（${(0, store_1.energyLabel)(car)}）${label}${costPart}` +
        `每公里 ¥${perKm}，不含${energyCostLabel} ¥${perKmExFuel}；` +
        `${consumptionPart}，总有效里程 ${snap.mileage.increased} km。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            scope: 'car',
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
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
            pagePath: `pages/statistics/index?id=${car.sourceId}&range=year`,
            linkText: '查看统计详情'
        }
    };
}
