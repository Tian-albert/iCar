"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryCars = queryCars;
// 原子接口：列出用户的车辆
//
// 回答「我有几辆车」「我的车叫什么」这类问题；
// 也是模型在多车场景下选 `carName` 的依据（先说清有哪些车，再记账）。
const store_1 = require("../lib/store");
async function queryCars() {
    var _a;
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: '用户还没有添加任何车辆。可以引导用户到「车辆」页点右上角「＋」添加第一辆车。'
                }
            ],
            // 无车时不带链接：唯一能引导的「车辆」页是 tabBar 页，navigateTo 跳不过去会静默失败
            structuredContent: { count: '0', items: '' },
            // 空库也接力到车辆页——那正是「去添加车辆」的目标
            handoff: () => ({ query: '', payload: { carCount: 0 } })
        };
    }
    const pinnedId = (_a = (0, store_1.getUser)()) === null || _a === void 0 ? void 0 : _a.pinnedCarId;
    const rows = cars.map(c => ({
        sourceId: c.sourceId,
        name: c.name,
        energyType: (0, store_1.energyLabel)(c),
        mileages: String(c.mileages || 0),
        pinned: c.sourceId === pinnedId
    }));
    // 置顶车排最前，其余保持原顺序（与「车辆」页观感一致）
    rows.sort((a, b) => Number(b.pinned) - Number(a.pinned));
    const items = rows
        .map(r => `${r.name}（${r.energyType}，${r.mileages} km${r.pinned ? '，置顶' : ''}）`)
        .join('；');
    const text = rows.length === 1
        ? `用户有 1 辆车：${items}。`
        : `用户有 ${rows.length} 辆车：${items}。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            count: String(rows.length),
            items,
            // 链到车辆详情（非 tabBar 页）而不是「车辆」列表页：
            // tabBar 页只能 switchTab，page-link 走 navigateTo 会静默失败
            // 不放 page-link：「车辆」是 tabBar 页，正文蓝链走 navigateTo 会静默失败；
            // 进入入口由下面的 handoff 承担
            pagePath: '',
            linkText: '查看我的车辆'
        },
        /**
         * 页面接力落到「我的车辆」列表页（tabBar 页），而不是某一辆车的详情。
         *
         * 问「我有几辆车」的人要看的是**列表**，把他带进某辆车的详情是错位——
         * 而且会让人误以为系统默认了这辆车。tabBar 页不带业务 query，只投 payload。
         */
        handoff: () => ({
            query: '',
            payload: { carCount: rows.length, names: rows.map(r => r.name).join('、') }
        })
    };
}
