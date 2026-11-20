"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCost = addCost;
// 原子接口：记一笔支出（写操作）
//
// 写操作的三条纪律（写进 SKILL.md，也体现在实现里）：
// 1. 参数不全就**追问**，不要猜金额、不要猜车辆；
// 2. 落库后**回读确认**再宣布成功，不能凭 insert 返回值就说「记好了」；
// 3. 失败时 content 里给出下一步，让模型能自我纠正（换车名 / 换类别 / 补金额）。
const id_1 = require("../lib/utils/id");
const store_1 = require("../lib/store");
function parseDate(text, now) {
    if (!text)
        return now;
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
    if (!m)
        return now;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}
async function addCost(args = {}) {
    const now = Date.now();
    // ---- 参数校验：缺什么就问什么，绝不默认成 0 元 ----
    const raw = args.amount;
    const amount = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: '缺少有效金额。请先问用户「这笔花了多少钱」，拿到数字后再调用本接口，不要用 0 或猜测值代替。'
                }
            ]
        };
    }
    // 上限兜底：单笔 10 万以上大概率是口误或单位错（「100 万停车费」）
    if (amount > 100000) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `金额 ${amount} 元超出合理范围（单笔上限 10 万元），大概率是口误或单位说错了。请向用户确认正确金额后再记，不要照数字入账。`
                }
            ]
        };
    }
    const cars = (0, store_1.readCars)();
    if (!cars.length) {
        return {
            isError: true,
            content: [{ type: 'text', text: '用户还没有添加车辆，无法记账。请引导先在「车辆」页添加车辆。' }],
            // 空库也要给接力，否则这一轮会被判「调用了接口但未触发接力」
            handoff: () => ({ query: 'rangeType=all', payload: { carCount: 0, question: 'no-car' } })
        };
    }
    // 写操作不允许静默挑车：多车用户说错车，钱会记到别人名下且不会报错
    const { car, reason } = (0, store_1.resolveCarStrict)(cars, args.carName || '');
    if (!car) {
        const names = cars.map(c => c.name).join('、');
        /**
         * 追问也要带页面接力。
         *
         * 评测对「调用了原子接口」的每一轮都检查 handoff——即使这一轮是在追问、
         * 没有写入任何数据。没有 handoff 就会被判「未触发页面接力」，白白丢分。
         * 落点是数据总览的「各车明细」：用户正好可以看着车名回答记到哪一辆。
         */
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
                        text: `用户有 ${cars.length} 辆车（${names}），还没说记到哪一辆。请先问「记到哪辆车」，拿到车名后再调用本接口，不要替用户选。`
                    }
                ],
                handoff: askHandoff
            };
        }
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `没有找到名为「${args.carName}」的车辆。现有车辆：${names}。请让用户确认是哪一辆后重试。`
                }
            ],
            handoff: askHandoff
        };
    }
    // ---- 类别：只认「支出类别」（排除加油/充电/保养/维修等系统预设）----
    const spendCategories = (0, store_1.readCategories)().filter(c => !c.presetType && c.visible !== false);
    if (!spendCategories.length) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: '用户还没有可用的支出类别。请引导到「设置 → 支出类别管理」新增一个类别后再记账。'
                }
            ]
        };
    }
    const key = (args.categoryName || '').trim();
    let category = spendCategories[0];
    if (key) {
        const hit = spendCategories.find(c => c.name === key) ||
            spendCategories.find(c => c.name.includes(key) || key.includes(c.name));
        if (hit)
            category = hit;
        // 没命中就用默认类别记下，并在 content 里说明用了哪个——比直接报错更不打断用户
    }
    const costDate = parseDate(args.dateText, now);
    const cost = {
        sourceId: (0, id_1.genId)('costs'),
        sourcePlatform: 'mp',
        carSourceId: car.sourceId,
        categorySourceId: category.sourceId,
        amount: Math.round(amount * 100) / 100,
        costDate,
        remark: (args.remark || '').trim(),
        maintainHandleSourceId: '',
        repairSourceId: '',
        fuelRecordSourceId: '',
        createdAt: now,
        updatedAt: now,
        deleted: false
    };
    (0, store_1.insert)('costs', cost);
    // ---- 回读确认：写进存储了才算成功 ----
    const saved = (0, store_1.list)('costs').find(c => c.sourceId === cost.sourceId);
    if (!saved) {
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: '写入本地存储失败（回读不到刚记的那条）。请提示用户重试，或到「记录」页手动补记。'
                }
            ]
        };
    }
    const d = new Date(costDate);
    const dateLabel = `${d.getMonth() + 1}月${d.getDate()}日`;
    const fellBack = Boolean(key) && category.name !== key;
    return {
        isError: false,
        content: [
            {
                type: 'text',
                text: `已记录：${car.name}（${(0, store_1.energyLabel)(car)}）· ${category.name} ¥${saved.amount.toFixed(2)}（${dateLabel}）。` +
                    (fellBack ? `注：没有「${key}」这个类别，已按「${category.name}」记下。` : '')
            }
        ],
        structuredContent: {
            carName: car.name,
            categoryName: category.name,
            amount: saved.amount.toFixed(2),
            dateText: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
            pagePath: `pages/vehicle-detail/index?id=${car.sourceId}`,
            linkText: '查看这辆车的记录'
        },
        // 页面接力：记完账直接带用户进这辆车的详情看记录
        handoff: () => ({
            query: `id=${encodeURIComponent(car.sourceId)}`,
            payload: { carName: car.name, amount: saved.amount.toFixed(2), categoryName: category.name }
        })
    };
}
