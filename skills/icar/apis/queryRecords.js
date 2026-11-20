"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRecords = queryRecords;
// 查某辆车的用车记录（近期明细）
//
// 只解决「翻得到」：某辆车在某段时间记过哪些账、分别多少钱。
// 金额以 costs 表为准——加油/保养/维修都会联动生成一条 cost，
// 再从 refuels / maintainHandles 反查会重复计数。
const stats_service_1 = require("../lib/domain/stats.service");
const store_1 = require("../lib/store");
function ymd(ts) {
    const d = new Date(ts);
    const mm = `${d.getMonth() + 1}`.padStart(2, '0');
    const dd = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}
function parseYmd(text) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec((text || '').trim());
    if (!m)
        return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}
function buildRange(args) {
    var _a;
    const now = new Date();
    if (args.rangeType === 'custom') {
        const start = parseYmd(args.startDate);
        const end = (_a = parseYmd(args.endDate)) !== null && _a !== void 0 ? _a : start;
        if (start !== null && end !== null)
            return { type: 'custom', start, end: Math.max(start, end) };
        return { type: 'all' };
    }
    if (args.rangeType === 'year')
        return { type: 'year', year: args.year || now.getFullYear() };
    if (args.rangeType === 'month') {
        return { type: 'month', year: args.year || now.getFullYear(), month: args.month || now.getMonth() + 1 };
    }
    return { type: 'all' };
}
async function queryRecords(args = {}) {
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆，没有记录可查。请引导先在「车辆」页添加车辆。' }],
            handoff: () => ({ query: 'rangeType=all', payload: { carCount: 0 } })
        };
    }
    const { car, reason } = (0, store_1.resolveCarStrict)(cars, args.carName || '');
    if (!car) {
        const names = cars.map(c => c.name).join('、');
        const askHandoff = () => ({
            query: 'rangeType=all',
            payload: { carCount: cars.length, question: 'which-car', names }
        });
        if (reason === 'ambiguous') {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `用户有 ${cars.length} 辆车（${names}），还没说查哪一辆的记录。请先问「哪辆车」，拿到车名后再调用。`
                    }
                ],
                handoff: askHandoff
            };
        }
        return {
            isError: true,
            content: [{ type: 'text', text: `没有找到名为「${args.carName}」的车辆。现有车辆：${names}。请让用户确认。` }],
            handoff: askHandoff
        };
    }
    const range = buildRange(args);
    const { start, end } = (0, stats_service_1.resolveRange)(range);
    const inRange = (t) => t >= start && t <= end;
    const categories = (0, store_1.readCategories)();
    const catName = (id) => { var _a; return ((_a = categories.find(c => c.sourceId === id)) === null || _a === void 0 ? void 0 : _a.name) || '其他'; };
    // 加油记录按 cost 反查：拿到「多少升」让明细更像明细
    const refuelByCost = new Map();
    for (const r of (0, store_1.readRefuels)()) {
        if (r.carSourceId === car.sourceId && r.costSourceId)
            refuelByCost.set(r.costSourceId, r);
    }
    const visibleTypes = args.type && args.type !== 'all' ? args.type : null;
    const rows = [];
    for (const c of (0, store_1.readCosts)()) {
        if (c.carSourceId !== car.sourceId || !inRange(c.costDate))
            continue;
        // 类型归类：谁生成的这条支出，就归到哪一类
        const type = c.fuelRecordSourceId ? 'fuel' : c.maintainHandleSourceId ? 'maintain' : c.repairSourceId ? 'repair' : 'cost';
        if (visibleTypes && type !== visibleTypes)
            continue;
        const fuel = c.fuelRecordSourceId ? refuelByCost.get(c.sourceId) : null;
        const summary = fuel
            ? `${fuel.energyType === 'ev' ? '充电' : '加油'} ${fuel.volume} ${fuel.energyType === 'ev' ? 'kWh' : '升'}`
            : c.remark || catName(c.categorySourceId);
        rows.push({
            date: c.costDate,
            dateText: ymd(c.costDate),
            typeLabel: catName(c.categorySourceId),
            summary,
            amount: c.amount
        });
    }
    // 没记金额的保养也要能在记录里看到（否则「我做过的保养」查不到）
    if (!visibleTypes || visibleTypes === 'maintain') {
        const costedHandles = new Set((0, store_1.readCosts)().filter(c => c.maintainHandleSourceId).map(c => c.maintainHandleSourceId));
        for (const h of (0, store_1.readHandles)()) {
            if (h.carSourceId !== car.sourceId || !inRange(h.makeDate))
                continue;
            if (costedHandles.has(h.sourceId))
                continue; // 已有金额记录，不重复
            rows.push({
                date: h.makeDate,
                dateText: ymd(h.makeDate),
                typeLabel: '保养',
                summary: h.remark || '保养记录',
                amount: 0
            });
        }
    }
    rows.sort((a, b) => b.date - a.date);
    const limit = Math.min(30, Math.max(1, Number(args.limit) || 10));
    const shown = rows.slice(0, limit);
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const rangeText = range.type === 'all'
        ? '全部时间'
        : range.type === 'year'
            ? `${range.year} 年`
            : range.type === 'month'
                ? `${range.year} 年 ${range.month} 月`
                : `${ymd(range.start)} 至 ${ymd(range.end)}`;
    const listText = shown.length
        ? shown.map(r => `${r.dateText.slice(5)} ${r.summary} ¥${r.amount.toFixed(2)}`).join('；')
        : '这段时间没有记录';
    const text = shown.length === 0
        ? `${car.name} 在${rangeText}没有记录。`
        : `${car.name} ${rangeText}共 ${rows.length} 条记录，合计 ¥${total.toFixed(2)}。` +
            `最近 ${shown.length} 条：${listText}。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            carName: car.name,
            rangeLabel: rangeText,
            count: String(rows.length),
            totalExpense: total.toFixed(2),
            items: listText,
            pagePath: 'pages/records/index',
            linkText: '查看全部记录'
        },
        // 页面接力：记录页（普通页，能直接打开）
        handoff: () => ({
            query: '',
            payload: { carName: car.name, count: rows.length, rangeLabel: rangeText }
        })
    };
}
