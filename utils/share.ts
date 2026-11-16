// 分享能力：统一落地页、标题与封面
//
// 关键约束：数据纯本地存储，接收方打开时本地没有任何车辆数据。
// 因此分享路径**必须**指向车辆列表页，不能带 carId —— 带 id 会让
// vehicle-detail 的 onLoad 判定"车辆不存在"并直接 navigateBack，
// 接收方看到的是闪退式的空白页。

/** 统一落地页：车辆列表（新用户会看到空态 + 添加车辆引导） */
export const SHARE_PATH = '/pages/index/index';

/** 分享封面：500x400（5:4），114KB，小于微信 128KB 上限 */
export const SHARE_IMAGE = '/assets/share-cover.png';

/** 默认标题（≤ 30 字，微信分享卡片不截断） */
export const DEFAULT_SHARE_TITLE = '油车 / 电车 / 混动都能记，自动算油耗电耗';

/** 微信分享卡片标题上限，超出会被截断，故主动收口 */
const MAX_TITLE_LENGTH = 30;

const SUFFIX = '｜车记本';

/** 按字数收口标题：保留亮点主体，必要时截断并补省略号 */
function composeTitle(highlight: string): string {
  if (!highlight) return DEFAULT_SHARE_TITLE;
  const full = `${highlight}${SUFFIX}`;
  if (full.length <= MAX_TITLE_LENGTH) return full;

  const budget = MAX_TITLE_LENGTH - SUFFIX.length - 1; // 1 位留给省略号
  if (budget <= 0) return SUFFIX.slice(1);
  return `${highlight.slice(0, budget)}…${SUFFIX}`;
}

export interface ShareContext {
  /** 个性化亮点，如「我的 CRV 已行驶 5850 km」；留空用默认标题 */
  highlight?: string;
}

export interface ShareMessage {
  title: string;
  path: string;
  imageUrl: string;
}

export interface TimelineMessage {
  title: string;
  query: string;
  imageUrl: string;
}

/** 组装转发卡片（好友 / 群聊） */
export function buildShareMessage(ctx: ShareContext = {}): ShareMessage {
  return {
    title: composeTitle((ctx.highlight || '').trim()),
    path: SHARE_PATH,
    imageUrl: SHARE_IMAGE
  };
}

/** 组装朋友圈分享内容（朋友圈不支持 path，只能带 query） */
export function buildTimelineMessage(ctx: ShareContext = {}): TimelineMessage {
  return {
    title: composeTitle((ctx.highlight || '').trim()),
    query: '',
    imageUrl: SHARE_IMAGE
  };
}

/** 打开转发 / 朋友圈入口（未定义时静默跳过，便于单测在 node 环境运行） */
export function enableShareMenu(): void {
  if (typeof wx === 'undefined' || typeof wx.showShareMenu !== 'function') return;
  wx.showShareMenu({
    withShareTicket: false,
    menus: ['shareAppMessage', 'shareTimeline']
  });
}
