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

function nonEmpty(v: unknown): boolean {
  return v !== undefined && v !== null && `${v}` !== '';
}

/** 'a=1&b=2' → { a:'1', b:'2' }；解码失败时保留原值，不抛错 */
export function parseQueryString(query?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const idx = pair.indexOf('=');
    const k = idx >= 0 ? pair.slice(0, idx) : pair;
    if (!k) continue;
    const raw = idx >= 0 ? pair.slice(idx + 1) : '';
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(raw);
    } catch (e) {
      out[k] = raw;
    }
  }
  return out;
}

/**
 * payload 里与页面 query 同义的字段。
 *
 * 接口在 payload 里带上 carId / tab 这些「页面必需参数」，
 * 即使 query 没送达，页面也能还原成「用户问的那辆车、那个 Tab」。
 */
function paramsFromPayload(payload?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!payload) return out;
  const pairs: Array<[string, string]> = [
    ['carId', 'id'],
    ['carName', 'carName'],
    ['tab', 'tab'],
    ['categoryName', 'category'],
    ['rangeType', 'rangeType'],
    ['range', 'range'],
    ['year', 'year'],
    ['month', 'month'],
    ['start', 'start'],
    ['end', 'end'],
    ['focus', 'focus'],
    ['cat', 'cat']
  ];
  for (const [src, dst] of pairs) {
    if (nonEmpty(payload[src])) out[dst] = String(payload[src]);
  }
  return out;
}

/**
 * 页面参数解析：**三层兜底**。
 *
 *   ① options（URL 真实参数，最可信）
 *   ② handoff.query（接口拼的 query）
 *   ③ handoff.payload（接口算出的业务数据，兜底 carId/tab/区间）
 *
 * 实测里「页面不知道是哪辆车」「没聚焦到某个 Tab」都是因为只读了 ①，
 * 而平台不保证 query 一定能送达页面。
 */
export function resolveAgentParams(
  page: { getPageId?: () => string | number },
  options?: Record<string, string>
): { params: Record<string, string>; fromAgent: boolean } {
  const handoff = takeAgentHandoff(page);
  const merged: Record<string, string> = {
    ...paramsFromPayload(handoff?.payload),
    ...parseQueryString(handoff?.query)
  };
  for (const [k, v] of Object.entries(options || {})) {
    if (nonEmpty(v)) merged[k] = v;
  }
  return { params: merged, fromAgent: !!handoff };
}

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
