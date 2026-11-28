"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryCarDetail = queryCarDetail;
const store_1 = require("../lib/store");
const maintain_service_1 = require("../lib/domain/maintain.service");
function ymd(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${(d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1)}-${(d.getDate() < 10 ? '0' : '') + d.getDate()}`;
}
const DAY = 86400000;
/** 保养项统计：总数 / 待处理（超期 + 临近） */
function maintainStatOf(car, now) {
    const handles = (0, store_1.readHandles)();
    const logs = (0, store_1.readLogs)();
    const items = (0, store_1.readMaintains)().filter(m => m.carSourceId === car.sourceId);
    let pending = 0;
    for (const m of items) {
        const r = (0, maintain_service_1.calcRemaining)(m, (0, maintain_service_1.findLastHandle)(m, logs, handles), car, now, {
            mileage: car.maintainSoonMileage,
            days: car.maintainSoonDays
        });
        if ((0, maintain_service_1.isRemainOverdue)(r.remainMileage, r.remainDays) || r.urgent)
            pending += 1;
    }
    return { total: items.length, pending };
}
async function queryCarDetail(args = {}) {
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆。请引导先在「车辆」页添加车辆。' }],
            handoff: () => ({ query: '', payload: { carCount: 0 } })
        };
    }
    const asked = (args.carName || '').trim();
    const matched = (0, store_1.resolveCarStrict)(cars, asked);
    // 多车又没说哪辆：问清楚，别拿第一辆的档案糊弄
    if (!matched.car) {
        const names = cars.map(c => c.name).join('、');
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: asked
                        ? `没有找到名为「${asked}」的车辆。现有车辆：${names}。请让用户确认是哪一辆。`
                        : `用户有 ${cars.length} 辆车（${names}），要查哪一辆的详情？请先问清楚再调用。`
                }
            ],
            handoff: () => ({ query: '', payload: { carCount: cars.length, question: 'which-car' } })
        };
    }
    const car = matched.car;
    const now = Date.now();
    const stat = maintainStatOf(car, now);
    const year = new Date(now).getFullYear();
    const yearStart = new Date(year, 0, 1).getTime();
    const yearExpense = (0, store_1.readCosts)()
        .filter(c => c.carSourceId === car.sourceId && !c.deleted && c.costDate >= yearStart && c.costDate <= now)
        .reduce((s, c) => s + c.amount, 0);
    const serviceDays = car.initDate ? Math.max(0, Math.floor((now - car.initDate) / DAY)) : null;
    const parts = [
        `${car.name}（${(0, store_1.energyLabel)(car)}）`,
        `当前里程 ${car.mileages} km`,
        serviceDays === null ? '' : `购车 ${ymd(car.initDate)}（${serviceDays} 天）`,
        stat.total > 0 ? `保养 ${stat.total} 项${stat.pending > 0 ? `，其中 ${stat.pending} 项待处理` : '，全部在周期内'}` : '还没有配置保养项',
        `${year} 年支出 ¥${yearExpense.toFixed(2)}`
    ].filter(Boolean);
    const text = `${parts.join('；')}。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
            mileages: String(car.mileages),
            initDate: car.initDate ? ymd(car.initDate) : '',
            serviceDays: serviceDays === null ? '' : String(serviceDays),
            maintainTotal: String(stat.total),
            maintainPending: String(stat.pending),
            yearExpense: yearExpense.toFixed(2),
            pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
            linkText: '查看车辆详情'
        },
        handoff: () => ({
            query: `id=${encodeURIComponent(car.sourceId)}`,
            payload: { carId: car.sourceId, carName: car.name }
        })
    };
}
