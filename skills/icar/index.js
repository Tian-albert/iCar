"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// SKILL 注册入口
//
// 契约（见官方「接入方式」3.3）：
// · createSkill 的 path 必须与 app.json 的 agent.skills[].path 完全一致；
// · registerAPI 的 name 必须与 mcp.json 中 apis[].name 完全一致。
const addCar_1 = require("./apis/addCar");
const addCost_1 = require("./apis/addCost");
const addMaintain_1 = require("./apis/addMaintain");
const updateCar_1 = require("./apis/updateCar");
const addRefuel_1 = require("./apis/addRefuel");
const queryCars_1 = require("./apis/queryCars");
const queryMaintain_1 = require("./apis/queryMaintain");
const queryRecords_1 = require("./apis/queryRecords");
const queryExpiring_1 = require("./apis/queryExpiring");
const queryCarDetail_1 = require("./apis/queryCarDetail");
const queryFaq_1 = require("./apis/queryFaq");
const queryStats_1 = require("./apis/queryStats");
const SKILL_PATH = 'skills/icar';
const skill = wx.modelContext.createSkill(SKILL_PATH);
// 中间件：统一兜底。原子接口抛错时不能把裸异常丢给模型，
// 要转成「可读的失败原因 + 下一步建议」，否则模型只会一直重试同一个接口。
skill.use(async (ctx, next) => {
    try {
        await next();
    }
    catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(`[skill:${ctx.skillPath}] ${ctx.name} 执行失败`, message);
        throw new Error(`本地数据读取失败：${message}。请提示用户重试，或引导到对应页面手动操作。`);
    }
});
skill.registerAPI('queryCars', queryCars_1.queryCars);
skill.registerAPI('queryStats', queryStats_1.queryStats);
skill.registerAPI('queryMaintain', queryMaintain_1.queryMaintain);
skill.registerAPI('queryRecords', queryRecords_1.queryRecords);
skill.registerAPI('queryExpiring', queryExpiring_1.queryExpiring);
skill.registerAPI('queryCarDetail', queryCarDetail_1.queryCarDetail);
skill.registerAPI('queryFaq', queryFaq_1.queryFaq);
skill.registerAPI('addCost', addCost_1.addCost);
skill.registerAPI('addRefuel', addRefuel_1.addRefuel);
skill.registerAPI('addMaintain', addMaintain_1.addMaintain);
skill.registerAPI('addCar', addCar_1.addCar);
skill.registerAPI('updateCar', updateCar_1.updateCar);
