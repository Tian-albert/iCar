"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryMaintain = queryMaintain;
// 原子接口：查询某辆车的保养剩余量与到期情况
//
// 复用主包 domain/maintain.service 的 calcRemaining / findLastHandle / formatRemainText，
// 阈值取车主自己设置的值（car.maintainSoonMileage / maintainSoonDays）。
const maintain_service_1 = require("../lib/domain/maintain.service");
const store_1 = require("../lib/store");
async function queryMaintain(args = {}) {
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆，没有保养数据可用。请引导先添加车辆。' }]
        };
    }
    const car = (0, store_1.pickCar)(cars, args.carName || '');
    if (!car) {
        return {
            isError: true,
            content: [{ type: 'text', text: `没有找到名为「${args.carName}」的车辆。` }]
        };
    }
    const maintains = (0, store_1.readMaintains)().filter(m => m.carSourceId === car.sourceId);
    if (!maintains.length) {
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
    const handles = (0, store_1.readHandles)().filter(h => h.carSourceId === car.sourceId);
    const logs = (0, store_1.readLogs)().filter(l => l.carSourceId === car.sourceId);
    const now = Date.now();
    const thresholds = {
        mileage: typeof car.maintainSoonMileage === 'number' ? car.maintainSoonMileage : 500,
        days: typeof car.maintainSoonDays === 'number' ? car.maintainSoonDays : 15
    };
    const rows = maintains
        .map(m => {
        const last = (0, maintain_service_1.findLastHandle)(m, logs, handles);
        const r = (0, maintain_service_1.calcRemaining)(m, last, car, now, thresholds);
        return {
            name: m.name,
            remainText: (0, maintain_service_1.formatRemainText)(r.remainMileage, r.remainDays),
            overdue: (0, maintain_service_1.isRemainOverdue)(r.remainMileage, r.remainDays),
            urgent: r.urgent,
            progress: Math.round(r.progress * 100)
        };
    })
        .sort((a, b) => {
        // 超期 > 临近 > 正常；同级按进度降序（越接近到期越靠前）
        const rank = (x) => (x.overdue ? 0 : x.urgent ? 1 : 2);
        return rank(a) - rank(b) || b.progress - a.progress;
    });
    const onlyUrgent = args.onlyUrgent !== false;
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
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
            overdueCount: String(overdueCount),
            urgentCount: String(visible.length),
            items: visible.slice(0, 5).map(r => `${r.name}｜${r.remainText}`).join('；'),
            pagePath: `/pages/vehicle-detail/index?id=${car.sourceId}`,
            linkText: '查看保养进度'
        }
    };
}
