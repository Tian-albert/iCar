"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryRecords = queryRecords;
// 查用车记录（明细）
//
// 两种作用域：
//   ① 说了车名 → 那一辆车的记录
//   ② 没说车名 / 说了但匹配不上 + 多辆车 → **全部车辆汇总**（合计 + 按车金额）
//
// ② 是这一轮评测暴露的关键缺口：用户问「所有车这两天停车费多少」，
// 旧实现强制单车、直接报错，模型只好一辆一辆查 6 次，最后还可能放弃。
//
// 金额一律以 costs 表为准——加油/保养/维修都会联动生成一条 cost，
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
/** 记录页的 query：页面靠它还原车辆、类别与区间，否则落进去是空白列表 */
function recordsQuery(args, carName) {
    const parts = [];
    if (carName)
        parts.push(`carName=${encodeURIComponent(carName)}`);
    if (args.type && args.type !== 'all')
        parts.push(`type=${args.type}`);
    if (args.categoryName)
        parts.push(`category=${encodeURIComponent(args.categoryName)}`);
    if (args.rangeType === 'year')
        parts.push(`rangeType=year&year=${args.year || new Date().getFullYear()}`);
    else if (args.rangeType === 'month') {
        parts.push(`rangeType=month&year=${args.year || new Date().getFullYear()}&month=${args.month || new Date().getMonth() + 1}`);
    }
    else if (args.rangeType === 'custom' && args.startDate) {
        parts.push(`rangeType=custom&start=${args.startDate}&end=${args.endDate || args.startDate}`);
    }
    else
        parts.push('rangeType=all');
    return parts.join('&');
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
    const askedName = (args.carName || '').trim();
    const matched = (0, store_1.resolveCarStrict)(cars, askedName);
    // 名字对应多辆车 → 让用户选一辆，不要拿全车汇总顶替
    if (askedName && matched.reason === 'ambiguous' && matched.candidates) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `「${askedName}」对应多辆车：${matched.candidates.join('、')}。请让用户确认是哪一辆，不要自己挑。`
                }
            ]
        };
    }
    // 多车且没锁定某一辆 → 全车汇总（不再报错逼用户选车）
    const isAllScope = !matched.car && cars.length > 1;
    const scopeCars = matched.car ? [matched.car] : cars;
    const nameMissNote = isAllScope && askedName ? `没有找到叫「${askedName}」的车，下面是全部 ${cars.length} 辆车的记录：` : '';
    // 分类过滤：先解析出唯一分类，解析不到就报错并列出可选
    const catKey = (args.categoryName || '').trim();
    const categories = (0, store_1.readCategories)().filter(c => !c.deleted);
    let catId = '';
    let catLabel = '';
    if (catKey) {
        const hit = categories.find(c => c.name.includes(catKey) || catKey.includes(c.name));
        if (!hit) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `没有叫「${catKey}」的支出分类。现有分类：${categories.map(c => c.name).join('、')}。请让用户从中选一个。`
                    }
                ]
            };
        }
        catId = hit.sourceId;
        catLabel = hit.name;
    }
    const range = buildRange(args);
    const { start, end } = (0, stats_service_1.resolveRange)(range);
    const inRange = (t) => t >= start && t <= end;
    const catNameOf = (id) => { var _a; return ((_a = categories.find(c => c.sourceId === id)) === null || _a === void 0 ? void 0 : _a.name) || '其他'; };
    const scopeIds = new Set(scopeCars.map(c => c.sourceId));
    const nameOf = (id) => { var _a; return ((_a = cars.find(c => c.sourceId === id)) === null || _a === void 0 ? void 0 : _a.name) || ''; };
    // 加油记录按 cost 反查：拿到「多少升」让明细更像明细
    const refuelByCost = new Map();
    for (const r of (0, store_1.readRefuels)()) {
        if (scopeIds.has(r.carSourceId) && r.costSourceId)
            refuelByCost.set(r.costSourceId, r);
    }
    const visibleTypes = args.type && args.type !== 'all' ? args.type : null;
    const rows = [];
    for (const c of (0, store_1.readCosts)()) {
        if (c.deleted || !scopeIds.has(c.carSourceId) || !inRange(c.costDate))
            continue;
        if (catId && c.categorySourceId !== catId)
            continue;
        const type = c.fuelRecordSourceId ? 'fuel' : c.maintainHandleSourceId ? 'maintain' : c.repairSourceId ? 'repair' : 'cost';
        if (visibleTypes && type !== visibleTypes)
            continue;
        const fuel = c.fuelRecordSourceId ? refuelByCost.get(c.sourceId) : null;
        const summary = fuel
            ? `${fuel.energyType === 'ev' ? '充电' : '加油'} ${fuel.volume} ${fuel.energyType === 'ev' ? 'kWh' : '升'}`
            : c.remark || catNameOf(c.categorySourceId);
        rows.push({
            carSourceId: c.carSourceId,
            carName: nameOf(c.carSourceId),
            date: c.costDate,
            dateText: ymd(c.costDate),
            typeLabel: catNameOf(c.categorySourceId),
            summary,
            amount: c.amount
        });
    }
    // 没记金额的保养也要能在记录里看到（否则「我做过的保养」查不到）
    if ((!visibleTypes || visibleTypes === 'maintain') && !catId) {
        const costedHandles = new Set((0, store_1.readCosts)().filter(c => c.maintainHandleSourceId).map(c => c.maintainHandleSourceId));
        for (const h of (0, store_1.readHandles)()) {
            if (!scopeIds.has(h.carSourceId) || !inRange(h.makeDate))
                continue;
            if (costedHandles.has(h.sourceId))
                continue; // 已有金额记录，不重复
            rows.push({
                carSourceId: h.carSourceId,
                carName: nameOf(h.carSourceId),
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
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const rangeText = range.type === 'all'
        ? '全部时间'
        : range.type === 'year'
            ? `${range.year} 年`
            : range.type === 'month'
                ? `${range.year} 年 ${range.month} 月`
                : `${ymd(range.start)} 至 ${ymd(range.end)}`;
    const label = catLabel ? `「${catLabel}」` : '';
    // 按车汇总（全车作用域才需要，最多 6 行，0 元车不列）
    const perCar = new Map();
    for (const r of rows) {
        const e = perCar.get(r.carSourceId) || { amount: 0, count: 0 };
        e.amount += r.amount;
        e.count += 1;
        perCar.set(r.carSourceId, e);
    }
    const carLines = [...perCar.entries()]
        .map(([id, v]) => (Object.assign({ name: nameOf(id) }, v)))
        .filter(x => x.amount > 0 || x.count > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6);
    const carText = carLines.map(c => `${c.name} ¥${c.amount.toFixed(2)}（${c.count} 笔）`).join('、');
    const shown = rows.slice(0, limit);
    const listText = shown.length
        ? shown.map(r => `${r.dateText.slice(5)} ${r.summary} ¥${r.amount.toFixed(2)}`).join('；')
        : '这段时间没有记录';
    let text;
    if (!rows.length) {
        text = `${isAllScope ? `${cars.length} 辆车` : scopeCars[0].name} 在${rangeText}${label ? `的${label}记录` : ''}没有记录。`;
    }
    else if (isAllScope) {
        text =
            nameMissNote +
                `${cars.length} 辆车 ${rangeText}${label}共 ${rows.length} 笔，合计 ¥${total.toFixed(2)}。` +
                (carText ? `按车：${carText}。` : '') +
                `最近 ${Math.min(3, shown.length)} 笔：${shown
                    .slice(0, 3)
                    .map(r => `${r.dateText.slice(5)} ${r.summary} ¥${r.amount.toFixed(2)}`)
                    .join('、')}。`;
    }
    else {
        text =
            `${scopeCars[0].name} ${rangeText}${label}共 ${rows.length} 笔，合计 ¥${total.toFixed(2)}。` +
                `最近 ${shown.length} 笔：${listText}。`;
    }
    const carName = matched.car ? matched.car.name : '';
    const query = recordsQuery(args, carName);
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            scope: isAllScope ? 'all' : 'car',
            carName: carName || `${cars.length} 辆车`,
            rangeLabel: rangeText,
            categoryName: catLabel,
            count: String(rows.length),
            totalExpense: total.toFixed(2),
            byCar: carText,
            items: listText,
            pagePath: `pages/records/index?${query}`,
            linkText: '查看全部记录'
        },
        // 页面接力：带上车辆/类别/区间，落进去就是筛好的列表，不再是空白页
        handoff: () => ({
            query,
            payload: { carName, count: rows.length, rangeLabel: rangeText, categoryName: catLabel }
        })
    };
}
