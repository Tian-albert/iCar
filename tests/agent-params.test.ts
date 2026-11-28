// 页面参数的三层兜底：options → handoff.query → handoff.payload
//
// 第四轮评测里 13 条「页面不知道是哪辆车 / 没聚焦」都源于只读 options：
// 平台不保证 handoff 的 query 一定拼到页面路径上，payload 必须能兜住。
import { parseQueryString, resolveAgentParams } from '../utils/agent-handoff';

function mockApp(store: Record<string, any>) {
  (globalThis as any).getApp = () => ({ globalData: { agentHandoffs: store } });
}
const page = (id: number) => ({ getPageId: () => id });

describe('parseQueryString', () => {
  it('解析并解码', () => {
    expect(parseQueryString('id=mp%3Acars%3A1&tab=cost')).toEqual({ id: 'mp:cars:1', tab: 'cost' });
  });

  it('空串 / 非法编码不抛错', () => {
    expect(parseQueryString('')).toEqual({});
    expect(parseQueryString('a=%E0%A4%A')).toEqual({ a: '%E0%A4%A' });
  });
});

describe('resolveAgentParams：三层兜底', () => {
  it('query 没送达时，用 payload 里的 carId / tab 还原', () => {
    mockApp({ 1: { query: '', payload: { carId: 'mp:cars:9', tab: 'cost' } } });
    const { params } = resolveAgentParams(page(1), {});
    expect(params.id).toBe('mp:cars:9');
    expect(params.tab).toBe('cost');
  });

  it('query 优先于 payload', () => {
    mockApp({
      1: { query: 'id=mp%3Acars%3A1&tab=fuel', payload: { carId: 'mp:cars:9', tab: 'cost' } }
    });
    const { params } = resolveAgentParams(page(1), {});
    expect(params.id).toBe('mp:cars:1');
    expect(params.tab).toBe('fuel');
  });

  it('URL 参数优先级最高，空值不会覆盖已有值', () => {
    mockApp({ 1: { query: 'tab=cost', payload: { carId: 'mp:cars:9' } } });
    const { params } = resolveAgentParams(page(1), { id: 'mp:cars:2', tab: '' });
    expect(params.id).toBe('mp:cars:2');
    // 空串不算有效值，保留 query 里的 cost
    expect(params.tab).toBe('cost');
  });

  it('拿走后即删，避免 globalData 无限增长', () => {
    const store: Record<string, any> = { 1: { query: 'tab=cost', payload: {} } };
    mockApp(store);
    resolveAgentParams(page(1), {});
    expect(store[1]).toBeUndefined();
  });

  it('没有 handoff 时退回 options，fromAgent 为 false', () => {
    mockApp({});
    const res = resolveAgentParams(page(1), { id: 'x' });
    expect(res.params.id).toBe('x');
    expect(res.fromAgent).toBe(false);
  });
});
