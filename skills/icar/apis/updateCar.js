"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateCar = updateCar;
// 编辑车辆信息（改名 / 改能量类型 / 改里程 / 改电池容量）
//
// 与 addCar 分开的原因：改名的风险远高于新增——重名会让「按车名找车」产生歧义，
// 所以必须先校验唯一性再落库。
const store_1 = require("../lib/store");
async function updateCar(args = {}) {
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆，没有可修改的对象。请引导先在「车辆」页添加车辆。' }],
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
                        text: `用户有 ${cars.length} 辆车（${names}），还没说要改哪一辆。请先问「改哪辆车」，拿到车名后再调用。`
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
    const changed = [];
    const newName = (args.newName || '').trim();
    if (newName && newName !== car.name) {
        if (cars.some(c => c.sourceId !== car.sourceId && c.name.trim() === newName)) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `已经有一辆叫「${newName}」的车了，改名会撞车。请让用户换一个名字。`
                    }
                ],
                handoff: () => ({ query: `id=${encodeURIComponent(car.sourceId)}`, payload: { carName: car.name } })
            };
        }
        changed.push(`名称 ${car.name} → ${newName}`);
        car.name = newName;
    }
    if (args.energyType === 'fuel' || args.energyType === 'ev' || args.energyType === 'hybrid') {
        if (args.energyType !== car.energyType) {
            changed.push(`能量类型 ${(0, store_1.energyLabel)(car)} → ${(0, store_1.energyLabel)(Object.assign(Object.assign({}, car), { energyType: args.energyType }))}`);
            car.energyType = args.energyType;
        }
    }
    const mileages = Number(args.mileages);
    if (isFinite(mileages) && mileages > 0 && mileages !== car.mileages) {
        changed.push(`当前里程 ${car.mileages} → ${mileages} km`);
        car.mileages = mileages;
    }
    const battery = Number(args.batteryCapacity);
    if (isFinite(battery) && battery > 0 && battery !== car.batteryCapacity) {
        changed.push(`电池容量 ${car.batteryCapacity} → ${battery} kWh`);
        car.batteryCapacity = battery;
    }
    if (!changed.length) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `${car.name} 这些信息都没有变化。请先问用户要改什么（名称、能量类型、当前里程或电池容量），不要空调用。`
                }
            ],
            handoff: () => ({ query: `id=${encodeURIComponent(car.sourceId)}`, payload: { carName: car.name } })
        };
    }
    car.updatedAt = Date.now();
    (0, store_1.update)('cars', car);
    const text = `已更新：${car.name}（${(0, store_1.energyLabel)(car)}）——${changed.join('；')}。`;
    return {
        isError: false,
        content: [{ type: 'text', text }],
        structuredContent: {
            carName: car.name,
            energyType: (0, store_1.energyLabel)(car),
            mileages: String(car.mileages),
            batteryCapacity: String(car.batteryCapacity),
            changed: changed.join('；'),
            pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
            linkText: '查看车辆详情'
        },
        handoff: () => ({
            query: `id=${encodeURIComponent(car.sourceId)}`,
            payload: { carName: car.name, changed: changed.join('；') }
        })
    };
}
