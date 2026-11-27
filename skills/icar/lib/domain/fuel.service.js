"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_EV_CONSUMPTION = exports.MIN_FUEL_CONSUMPTION = exports.MIN_SEGMENT_MILEAGE = exports.MAX_EV_CONSUMPTION = exports.MAX_FUEL_CONSUMPTION = void 0;
exports.clampFuelConsumption = clampFuelConsumption;
exports.computeShouldPay = computeShouldPay;
exports.buildConsumption = buildConsumption;
exports.rebuildConsumptions = rebuildConsumptions;
exports.rebuildConsumptionsGrouped = rebuildConsumptionsGrouped;
exports.summarizeConsumptions = summarizeConsumptions;
const number_1 = require("../utils/number");
/**
 * 单车油耗合理上限（L/100km）。
 * 极小里程区间（如 1km）会因录入误差算出数千的荒谬数值，统一收敛到该上限，
 * 避免污染统计指标并把图表点画到画布外；录入数据修正后重算即恢复真值。
 */
exports.MAX_FUEL_CONSUMPTION = 30;
/**
 * 纯电车电耗合理上限（kWh/100km）。
 * 与油耗上限分开：冬季高电耗车型可达 33，套用 30 会把真实值截断。
 */
exports.MAX_EV_CONSUMPTION = 50;
/** 统一收敛所有对外展示的油耗值（区间值、汇总平均、统计页平均），保证口径一致 */
function clampFuelConsumption(value) {
    if (!isFinite(value))
        return 0;
    return Math.max(0, Math.min(value, exports.MAX_FUEL_CONSUMPTION));
}
/**
 * 区间可信度下界。
 *
 * 只有上限收敛是不够的：里程只涨了 30km 却记了 40 升，会算出 1.33 L/100km
 * 这种"比摩托车还省"的数（实测评测里就出现过）。这类区间不是真实油耗，
 * 而是录入/补录错误，**整段丢弃**比夹到某个值更诚实。
 */
exports.MIN_SEGMENT_MILEAGE = 30;
exports.MIN_FUEL_CONSUMPTION = 2;
exports.MIN_EV_CONSUMPTION = 5;
/** 区间是否可信：里程够长，且折算出的能耗落在物理可能范围 */
function isPlausibleSegment(mileage, fuelAmount, energyType) {
    if (mileage < exports.MIN_SEGMENT_MILEAGE || fuelAmount <= 0)
        return false;
    const per100 = (fuelAmount / mileage) * 100;
    const isEv = energyType === 'ev';
    return per100 >= (isEv ? exports.MIN_EV_CONSUMPTION : exports.MIN_FUEL_CONSUMPTION);
}
/**
 * 金额联动：应付金额 = 单价 × 加油量（四舍五入 2 位）
 * 实付金额默认取应付金额（用户可改，由调用方决定）
 */
function computeShouldPay(unitPrice, volume) {
    return (0, number_1.round2)(unitPrice * volume);
}
/**
 * 依据区间规则计算一条油耗区间；不成立时返回 null（设计报告 5.2.2）。
 *
 * 区间成立条件：E.isFull === true 且（S.isFull === true 或 S.isLowFuel === true）。
 * 区间油耗量 / 区间金额：S.isFull ? 取 E : 取 S。
 */
/** 组装一条区间实体（相邻配对与跨段累积共用） */
function makeSegment(start, end, mileage, fuelAmount, cost) {
    return {
        sourceId: `mp:fuel-consumption:${start.sourceId}:${end.sourceId}`,
        sourcePlatform: 'mp',
        carSourceId: end.carSourceId,
        energyType: end.energyType,
        startFuelRecordSourceId: start.sourceId,
        endFuelRecordSourceId: end.sourceId,
        startDate: start.fuelDate,
        endDate: end.fuelDate,
        fuelDate: end.fuelDate,
        mileage,
        fuelAmount,
        fuelConsumption: clampFuelConsumption((fuelAmount / mileage) * 100),
        cost,
        costPerKm: isFinite(cost) && mileage > 0 ? cost / mileage : 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deleted: false
    };
}
/** 相邻两条的区间判定（BR-5.2 口径，保留供单点校验与既有测试使用） */
function buildConsumption(start, end) {
    const valid = end.isFull && (start.isFull || start.isLowFuel);
    if (!valid)
        return null;
    const mileage = end.makeMileages - start.makeMileages;
    if (mileage <= 0)
        return null;
    const fuelAmount = start.isFull ? end.volume : start.volume;
    const cost = start.isFull ? end.actualPayAmount : start.actualPayAmount;
    // 此处只做上限收敛（历史口径，供单点校验与既有测试使用）；
    // 「不可信区间整段丢弃」发生在 rebuildConsumptions——那才是真实数据进图表/统计的入口。
    return makeSegment(start, end, mileage, fuelAmount, cost);
}
/**
 * 重建某车的全部油耗区间（BR-25，R-04 修订口径）。
 *
 * 1. 稳定排序：fuelDate → makeMileages → sourceId，同日多次加油也有确定先后。
 * 2. 锚点 = 最近一次「加满」或「低油量补油」；此后所有加油量/金额累积，
 *    直到遇到下一条「加满」记录才结算为一段区间。这样中间的「未加满」
 *    不再打断整段，其有效里程与油耗不会丢失。
 * 3. 区间里程 = 终点里程 − 锚点里程；区间油量/金额 = 锚点之后到终点（含）之和。
 *
 * 入参为软删过滤后的现存记录；任何增删改后全量重算。
 */
function rebuildConsumptions(logs) {
    const sorted = [...logs].sort((a, b) => a.fuelDate - b.fuelDate ||
        a.makeMileages - b.makeMileages ||
        a.sourceId.localeCompare(b.sourceId));
    const result = [];
    let anchor = null;
    let fuelAmount = 0;
    let cost = 0;
    for (const cur of sorted) {
        if (!anchor) {
            if (cur.isFull || cur.isLowFuel)
                anchor = cur;
            continue;
        }
        const mileage = cur.makeMileages - anchor.makeMileages;
        if (mileage <= 0)
            continue; // 里程倒退/重复记录不参与统计
        fuelAmount += cur.volume;
        cost += cur.actualPayAmount;
        if (cur.isFull) {
            // 不可信区间整段丢弃（里程过短 / 折算值低于物理下界），锚点照常前移
            if (isPlausibleSegment(mileage, fuelAmount, cur.energyType || 'fuel')) {
                result.push(makeSegment(anchor, cur, mileage, fuelAmount, cost));
            }
            anchor = cur;
            fuelAmount = 0;
            cost = 0;
        }
    }
    return result;
}
/**
 * 按能量类型分组重建区间（R-07）。
 * 混动车同时存在加油与充电记录，必须分开成段，否则会把 L 与 kWh 混加。
 * 服务层与统计页共用，保证两处口径一致。
 */
function rebuildConsumptionsGrouped(logs) {
    var _a;
    const groups = new Map();
    for (const l of logs) {
        const t = l.energyType || 'fuel';
        const arr = (_a = groups.get(t)) !== null && _a !== void 0 ? _a : [];
        arr.push(l);
        groups.set(t, arr);
    }
    const out = [];
    for (const group of groups.values())
        out.push(...rebuildConsumptions(group));
    return out;
}
/**
 * 汇总若干区间的统计（供详情页"平均油耗 / 元每公里"使用）。
 * 注意与统计页口径区分：此处元/km 取 2 位（0.63），统计页取 3 位（1.317）。
 */
function summarizeConsumptions(list) {
    const mileage = list.reduce((s, c) => s + c.mileage, 0);
    const fuelAmount = list.reduce((s, c) => s + c.fuelAmount, 0);
    const cost = list.reduce((s, c) => s + c.cost, 0);
    return {
        mileage,
        fuelAmount,
        cost,
        avgConsumption: mileage > 0 ? (0, number_1.round2)(clampFuelConsumption((fuelAmount / mileage) * 100)) : 0,
        costPerKm: mileage > 0 ? (0, number_1.round2)(cost / mileage) : 0
    };
}
