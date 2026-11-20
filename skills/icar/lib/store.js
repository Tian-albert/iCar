"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readLogs = exports.readHandles = exports.readMaintains = exports.readConsumptions = exports.readRefuels = exports.readCosts = exports.readCategories = exports.readCars = void 0;
exports.list = list;
exports.insert = insert;
exports.get = get;
exports.update = update;
exports.hardDelete = hardDelete;
exports.getUser = getUser;
exports.resolveCarStrict = resolveCarStrict;
exports.pickCar = pickCar;
exports.energyLabel = energyLabel;
const KEY_INDEX = 'icar:index';
const KEY_USER = 'icar:user';
function readIndex() {
    try {
        const v = wx.getStorageSync(KEY_INDEX);
        return v && typeof v === 'object' ? v : {};
    }
    catch (e) {
        // 存储异常时按空库处理：AI 侧宁可回答「没有数据」，也不能抛错中断对话
        return {};
    }
}
/** 读一张表的全部未删除记录 */
function list(table) {
    const ids = readIndex()[table] || [];
    const out = [];
    for (const id of ids) {
        try {
            const v = wx.getStorageSync(`icar:${table}:${id}`);
            if (v && typeof v === 'object' && !v.deleted) {
                out.push(v);
            }
        }
        catch (e) {
            // 单条损坏不影响整表
        }
    }
    return out;
}
/** 写入一条记录并维护索引（与主包 StorageAdapter.insert 行为一致） */
function insert(table, entity) {
    wx.setStorageSync(`icar:${table}:${entity.sourceId}`, entity);
    const index = readIndex();
    const ids = index[table] || [];
    if (!ids.includes(entity.sourceId)) {
        ids.push(entity.sourceId);
        index[table] = ids;
        wx.setStorageSync(KEY_INDEX, index);
    }
    return entity;
}
/** 按 id 取单条（含已删除的，由调用方判断 deleted） */
function get(table, id) {
    try {
        const v = wx.getStorageSync(`icar:${table}:${id}`);
        return v && typeof v === 'object' ? v : null;
    }
    catch (e) {
        return null;
    }
}
/** 覆盖更新（记录必须已存在，索引不变） */
function update(table, entity) {
    wx.setStorageSync(`icar:${table}:${entity.sourceId}`, entity);
    return entity;
}
/**
 * 物理删除（不写回收站）。
 *
 * 只用于「可重算的派生数据」——目前只有 `fuelConsumptions`：
 * 油耗区间由加油记录全量重算得出，留着旧区间会与新记录打架；
 * 用户真正在乎的记录（加油、支出）一律走软删。
 */
function hardDelete(table, id) {
    try {
        wx.removeStorageSync(`icar:${table}:${id}`);
        const index = readIndex();
        if (index[table]) {
            index[table] = index[table].filter(x => x !== id);
            wx.setStorageSync(KEY_INDEX, index);
        }
    }
    catch (e) {
        // 删除失败不影响主流程：区间会在下次重算时被覆盖
    }
}
function getUser() {
    try {
        const v = wx.getStorageSync(KEY_USER);
        return v && typeof v === 'object' ? v : null;
    }
    catch (e) {
        return null;
    }
}
const readCars = () => list('cars');
exports.readCars = readCars;
const readCategories = () => list('categories');
exports.readCategories = readCategories;
const readCosts = () => list('costs');
exports.readCosts = readCosts;
/** 加油/充电记录（主包表名是 fuelRecords，不是 refuels） */
const readRefuels = () => list('fuelRecords');
exports.readRefuels = readRefuels;
/** 油耗/电耗区间（主包表名 fuelConsumptions） */
const readConsumptions = () => list('fuelConsumptions');
exports.readConsumptions = readConsumptions;
const readMaintains = () => list('maintains');
exports.readMaintains = readMaintains;
const readHandles = () => list('maintainHandles');
exports.readHandles = readHandles;
const readLogs = () => list('maintainLogs');
exports.readLogs = readLogs;
/**
 * 写操作选车：**不允许静默回落到某辆车**。
 *
 * 多车用户说「停车 15」时，猜错车会把钱记到别人名下，而且是无声的——
 * 用户只有在月底对账时才发现。所以：
 *   · 只有 1 辆车 → 直接用它；
 *   · 说了车名 → 模糊匹配；
 *   · 多辆车且没说 → 返回 ambiguous，由调用方追问。
 */
function resolveCarStrict(cars, carName) {
    if (!cars.length)
        return { car: null, reason: 'no-car' };
    const key = (carName || '').trim();
    if (key) {
        const exact = cars.find(c => c.name === key);
        if (exact)
            return { car: exact };
        const fuzzy = cars.find(c => c.name.includes(key) || key.includes(c.name));
        if (fuzzy)
            return { car: fuzzy };
        return { car: null, reason: 'no-match' };
    }
    if (cars.length === 1)
        return { car: cars[0] };
    return { car: null, reason: 'ambiguous' };
}
/**
 * 读操作选车：显式指定 > 置顶车 > 第一辆车。
 *
 * 模糊匹配（contains）而不是全等：用户口语说「我的 CRV」，库里的名字是「我的 CRV 2021」。
 */
function pickCar(cars, carName) {
    var _a;
    if (!cars.length)
        return null;
    const key = (carName || '').trim();
    if (key) {
        const exact = cars.find(c => c.name === key);
        if (exact)
            return exact;
        const fuzzy = cars.find(c => c.name.includes(key) || key.includes(c.name));
        if (fuzzy)
            return fuzzy;
    }
    const pinnedId = (_a = getUser()) === null || _a === void 0 ? void 0 : _a.pinnedCarId;
    if (pinnedId) {
        const pinned = cars.find(c => c.sourceId === pinnedId);
        if (pinned)
            return pinned;
    }
    return cars[0];
}
/** 车型的中文口径（回答里要说人话，不能直接甩 fuel / ev） */
function energyLabel(car) {
    if (car.energyType === 'ev')
        return '纯电';
    if (car.energyType === 'hybrid')
        return '混动';
    return '燃油';
}
