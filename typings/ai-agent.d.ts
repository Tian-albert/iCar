// 小程序 AI 开发模式（beta）类型声明
//
// miniprogram-api-typings 里还没有 wx.modelContext / wx.onAgentHandoff，
// 这里按官方文档「接入方式 / 调试指南」的最小契约补声明，避免 typecheck 报错。
// 文档：https://developers.weixin.qq.com/miniprogram/dev/ai/integration

interface AgentTextContent {
  type: 'text';
  text: string;
}

interface AgentApiResult {
  isError?: boolean;
  content: AgentTextContent[];
  structuredContent?: Record<string, unknown>;
  handoff?: (data: {
    result: {
      isError: boolean;
      content: AgentTextContent[];
      structuredContent: Record<string, unknown>;
    };
  }) => { query?: string; payload?: Record<string, unknown>; path?: string };
}

interface AgentApiHandler {
  (args: Record<string, any>, context?: { query?: string }): Promise<AgentApiResult> | AgentApiResult;
}

interface AgentMiddlewareContext {
  name: string;
  skillPath: string;
  arguments: Record<string, any>;
}

type AgentMiddleware = (
  ctx: AgentMiddlewareContext,
  next: () => Promise<void>
) => Promise<void>;

interface AgentSkill {
  use(middleware: AgentMiddleware): void;
  registerAPI(name: string, handler: AgentApiHandler): void;
}

interface AgentHandoffInfo {
  pageId: number;
  path: string;
  query: string;
  payload: unknown;
}

declare namespace WechatMiniprogram {
  interface Wx {
    modelContext: {
      createSkill(skillPath: string): AgentSkill;
      registerAPI(name: string, handler: AgentApiHandler): void;
    };
    onAgentHandoff(callback: (info: AgentHandoffInfo) => void): void;
    offAgentHandoff(callback?: (info: AgentHandoffInfo) => void): void;
  }
}
