// SKILL 注册入口
//
// 契约（见官方「接入方式」3.3）：
// · createSkill 的 path 必须与 app.json 的 agent.skills[].path 完全一致；
// · registerAPI 的 name 必须与 mcp.json 中 apis[].name 完全一致。
import { addCar } from './apis/addCar';
import { addCost } from './apis/addCost';
import { addMaintain } from './apis/addMaintain';
import { updateCar } from './apis/updateCar';
import { addRefuel } from './apis/addRefuel';
import { queryCars } from './apis/queryCars';
import { queryMaintain } from './apis/queryMaintain';
import { queryRecords } from './apis/queryRecords';
import { queryExpiring } from './apis/queryExpiring';
import { queryCarDetail } from './apis/queryCarDetail';
import { queryFaq } from './apis/queryFaq';
import { queryStats } from './apis/queryStats';

const SKILL_PATH = 'skills/icar';

const skill = wx.modelContext.createSkill(SKILL_PATH);

// 中间件：统一兜底。原子接口抛错时不能把裸异常丢给模型，
// 要转成「可读的失败原因 + 下一步建议」，否则模型只会一直重试同一个接口。
skill.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const message = err && (err as Error).message ? (err as Error).message : String(err);
    console.error(`[skill:${ctx.skillPath}] ${ctx.name} 执行失败`, message);
    throw new Error(`本地数据读取失败：${message}。请提示用户重试，或引导到对应页面手动操作。`);
  }
});

skill.registerAPI('queryCars', queryCars);
skill.registerAPI('queryStats', queryStats);
skill.registerAPI('queryMaintain', queryMaintain);
skill.registerAPI('queryRecords', queryRecords);
skill.registerAPI('queryExpiring', queryExpiring);
skill.registerAPI('queryCarDetail', queryCarDetail);
skill.registerAPI('queryFaq', queryFaq);
skill.registerAPI('addCost', addCost);
skill.registerAPI('addRefuel', addRefuel);
skill.registerAPI('addMaintain', addMaintain);
skill.registerAPI('addCar', addCar);
skill.registerAPI('updateCar', updateCar);
