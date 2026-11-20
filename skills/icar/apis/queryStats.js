"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryStats = queryStats;
// 原子接口：查询某辆车在某维度下的支出与能耗统计
//
// 口径与统计页完全一致——直接复用主包的 domain/stats.service（镜像在 ../lib），
// 不在这里重写任何计算公式，避免「AI 说 8200、统计页显示 8100」。
const stats_service_1 = require("../lib/domain/stats.service");
const store_1 = require("../lib/store");
function rangeLabel(range) {
    if (range.type === 'all')
        return '全部时间';
    if (range.type === 'year')
        return `${range.year} 年`;
    return `${range.year} 年 ${range.month} 月`;
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
    const car = (0, store_1.pickCar)(cars, args.carName || '');
    if (!car) {
        return {
            isError: true,
            content: [{ type: 'text', text: `没有找到名为「${args.carName}」的车辆。` }]
        };
    }
    const now = new Date();
    const type = args.rangeType === 'month' || args.rangeType === 'all' ? args.rangeType : 'year';
    const range = type === 'all'
        ? { type: 'all' }
        : type === 'month'
            ? { type: 'month', year: args.year || now.getFullYear(), month: args.month || now.getMonth() + 1 }
            : { type: 'year', year: args.year || now.getFullYear() };
    const costs = (0, store_1.readCosts)().filter(c => c.carSourceId === car.sourceId);
    const refuels = (0, store_1.readRefuels)().filter(r => r.carSourceId === car.sourceId);
    const segs = (0, store_1.readConsumptions)().filter(s => s.carSourceId === car.sourceId);
    const categories = (0, store_1.readCategories)();
    const snap = (0, stats_service_1.buildStats)(range, costs, refuels, segs, categories, car);
    const label = rangeLabel(range);
    const isEv = car.energyType === 'ev';
    const total = snap.expense.total.toFixed(2);
    const perKm = snap.expense.perKm.toFixed(3);
    const perKmExFuel = snap.expense.perKmExFuel.toFixed(3);
    const energyName = isEv ? '电耗' : '油耗';
    const consumption = isEv ? snap.electricity.avgConsumption : snap.fuel.avgConsumption;
    const text = `${car.name}（${(0, store_1.energyLabel)(car)}）${label}支出 ¥${total}，` +
        `每公里 ¥${perKm}（不含能耗费用 ¥${perKmExFuel}）；` +
        `${energyName} ${consumption.toFixed(2)} ${isEv ? 'kWh/100km' : 'L/100km'}，` +
        `有效里程 ${snap.mileage.increased} km。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
            rangeLabel: label,
            totalExpense: total,
            perKm,
            perKmExFuel,
            avgConsumption: consumption.toFixed(2),
            consumptionUnit: isEv ? 'kWh/100km' : 'L/100km',
            mileageIncreased: String(snap.mileage.increased),
            // page-link：让回复正文里出现「#小程序：车记本/查看统计详情」
            pagePath: `/pages/statistics/index?id=${car.sourceId}&range=year`,
            linkText: '查看统计详情'
        }
    };
}
