// 页面接力（handoff）消费端
//
// 原子接口通过 handoff 返回 { query, payload }，App.onLaunch 里的 wx.onAgentHandoff
// 按 pageId 投递到 globalData.agentHandoffs，页面 onLoad 时按自己的 pageId 取走。
//
// 为什么不直接用 query：query 只承载「打开哪个页、带什么参数」，
// payload 才是接口算出来的业务数据（金额、油耗、超期数）。页面读走即删，
// 避免 globalData 随对话轮次无限增长。
export interface AgentHandoff {
  path?: string;
  query?: string;
  payload?: Record<string, unknown>;
}

/** 投递表：pageId → handoff（pageId 在基础库里是 number，类型声明里是 string，两者都兼容） */
type HandoffStore = Record<string | number, AgentHandoff>;

/**
 * 取走属于当前页面的 handoff（读完即删）。
 *
 * 任何异常都返回 null：页面接力是增强能力，绝不能让页面打不开。
 */
export function takeAgentHandoff(page: { getPageId?: () => string | number }): AgentHandoff | null {
  try {
    if (typeof getApp !== 'function') return null;
    const app: any = getApp();
    const store = (app && app.globalData ? app.globalData.agentHandoffs : null) as HandoffStore | null;
    if (!store) return null;

    const pageId = typeof page.getPageId === 'function' ? page.getPageId() : null;
    if (pageId === null || pageId === undefined) return null;

    const item = store[pageId];
    if (item) delete store[pageId];
    return item || null;
  } catch (e) {
    return null;
  }
}
