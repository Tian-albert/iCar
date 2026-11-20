"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryMaintain = queryMaintain;
// 原子接口：查询保养剩余量与到期情况
//
// 作用域与 queryStats 一致：
//   · 说了车名 / 只有一辆车 → 那一辆
//   · 没说车名 + 多辆车     → **所有车辆的待保养项汇总**（「有几项要保养」问的是全部）
//
// 复用主包 domain/maintain.service 的 calcRemaining / findLastHandle / formatRemainText，
// 阈值取车主自己设置的值（car.maintainSoonMileage / maintainSoonDays）。
const maintain_service_1 = require("../lib/domain/maintain.service");
const store_1 = require("../lib/store");
/** 一辆车的全部保养项剩余量（按 超期 → 临近 → 正常 排序） */
function rowsOf(car) {
    const maintains = (0, store_1.readMaintains)().filter(m => m.carSourceId === car.sourceId);
    if (!maintains.length)
        return [];
    const handles = (0, store_1.readHandles)().filter(h => h.carSourceId === car.sourceId);
    const logs = (0, store_1.readLogs)().filter(l => l.carSourceId === car.sourceId);
    const now = Date.now();
    const thresholds = {
        mileage: typeof car.maintainSoonMileage === 'number' ? car.maintainSoonMileage : 500,
        days: typeof car.maintainSoonDays === 'number' ? car.maintainSoonDays : 15
    };
    return maintains
        .map(m => {
        const last = (0, maintain_service_1.findLastHandle)(m, logs, handles);
        const r = (0, maintain_service_1.calcRemaining)(m, last, car, now, thresholds);
        return {
            carName: car.name,
            name: m.name,
            remainText: (0, maintain_service_1.formatRemainText)(r.remainMileage, r.remainDays),
            overdue: (0, maintain_service_1.isRemainOverdue)(r.remainMileage, r.remainDays),
            urgent: r.urgent,
            progress: Math.round(r.progress * 100)
        };
    })
        .sort((a, b) => {
        const rank = (x) => (x.overdue ? 0 : x.urgent ? 1 : 2);
        return rank(a) - rank(b) || b.progress - a.progress;
    });
}
async function queryMaintain(args = {}) {
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆，没有保养数据可用。请引导先添加车辆。' }]
        };
    }
    const onlyUrgent = args.onlyUrgent !== false;
    const askedName = (args.carName || '').trim();
    // ---------- 多车 + 没说车名：汇总所有车 ----------
    if (!askedName && cars.length > 1) {
        // 不用 flatMap：tsconfig 的 lib 是 ES2017，没有该方法
        const all = [];
        for (const c of cars)
            all.push(...rowsOf(c));
        if (!all.length) {
            return {
                isError: false,
                content: [
                    {
                        type: 'text',
                        text: '这些车都还没有配置保养项。可以引导用户到「保养管理」页添加机油、空气滤芯等常用项。'
                    }
                ]
            };
        }
        const visible = onlyUrgent ? all.filter(r => r.overdue || r.urgent) : all;
        const overdueCount = all.filter(r => r.overdue).length;
        if (!visible.length) {
            return {
                isError: false,
                content: [
                    {
                        type: 'text',
                        text: `${cars.length} 辆车的保养项都在周期内，暂无需要处理的项。`
                    }
                ],
                structuredContent: {
                    scope: 'all',
                    carCount: String(cars.length),
                    overdueCount: '0',
                    urgentCount: '0',
                    items: ''
                }
            };
        }
        // 每辆车最多列 2 项，总数最多 5 条，避免长回答
        const shown = visible.slice(0, 5);
        const detail = shown.map(r => `${r.carName} ${r.name}${r.remainText}`).join('；');
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: `${cars.length} 辆车共有 ${visible.length} 项需要关注` +
                        `${overdueCount ? `，其中 ${overdueCount} 项已超期` : ''}：${detail}。` +
                        `需要看某一辆的完整保养项，告诉我车名即可。`
                }
            ],
            structuredContent: {
                scope: 'all',
                carCount: String(cars.length),
                overdueCount: String(overdueCount),
                urgentCount: String(visible.length),
                items: detail
                // 全车汇总不给链接：「概览」是 tabBar 页（navigateTo 跳不过去），
                // 「保养管理」只接受单车 id，多车场景没有唯一目标页
            }
        };
    }
    // ---------- 单车 ----------
    // 说了车名就必须匹配上：库里没有这辆车时，答另一辆的保养剩余量是误导
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
    const rows = rowsOf(car);
    if (!rows.length) {
        return {
            isError: false,
            content: [
                {
                    type: 'text',
                    text: `${car.name} 还没有配置保养项。可以引导用户到「保养管理」页添加机油、空气滤芯等常用项。`
                }
            ]
        };
    }
    const visible = onlyUrgent ? rows.filter(r => r.overdue || r.urgent) : rows;
    const overdueCount = rows.filter(r => r.overdue).length;
    let text;
    if (!visible.length) {
        text = `${car.name}（${(0, store_1.energyLabel)(car)}）所有保养项都在周期内，暂无需要处理的项。`;
    }
    else {
        const lines = visible
            .slice(0, 3)
            .map(r => `${r.name}：${r.remainText}${r.overdue ? '（已超期）' : ''}`)
            .join('；');
        text =
            `${car.name}（${(0, store_1.energyLabel)(car)}）有 ${visible.length} 项需要关注` +
                `${overdueCount ? `，其中 ${overdueCount} 项已超期` : ''}：${lines}。`;
    }
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            scope: 'car',
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
            overdueCount: String(overdueCount),
            urgentCount: String(visible.length),
            items: visible.slice(0, 5).map(r => `${r.name}｜${r.remainText}`).join('；'),
            pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
            linkText: '查看保养进度'
        }
    };
}
