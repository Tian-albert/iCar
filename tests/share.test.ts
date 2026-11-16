// 分享能力单测：落地页、标题、封面
import {
  buildShareMessage,
  buildTimelineMessage,
  SHARE_PATH,
  SHARE_IMAGE,
  DEFAULT_SHARE_TITLE,
  enableShareMenu
} from '../utils/share';

// 项目 tsconfig.types 只含小程序类型，Node 模块声明不可用，故用 require
const fsx = require('fs') as any;

describe('分享落地页', () => {
  it('指向车辆列表页，且不带 carId', () => {
    const msg = buildShareMessage();
    expect(msg.path).toBe('/pages/index/index');
    // 本地存储无对方数据，带 id 会让详情页判定"车辆不存在"并 navigateBack
    expect(msg.path).not.toContain('id=');
    expect(msg.path).not.toContain('vehicle-detail');
  });

  it('路径必须是 tabBar 页面（否则 wx.switchTab 之外的分享无法落地）', () => {
    expect(['/pages/index/index', '/pages/reminder/index', '/pages/user/index'])
      .toContain(SHARE_PATH);
  });
});

describe('分享标题', () => {
  it('无亮点时使用默认标题', () => {
    expect(buildShareMessage().title).toBe(DEFAULT_SHARE_TITLE);
    expect(buildShareMessage({ highlight: '' }).title).toBe(DEFAULT_SHARE_TITLE);
    expect(buildShareMessage({ highlight: '   ' }).title).toBe(DEFAULT_SHARE_TITLE);
  });

  it('有亮点时拼接车记本后缀', () => {
    const msg = buildShareMessage({ highlight: '我的 CRV 已行驶 5850 km' });
    expect(msg.title).toBe('我的 CRV 已行驶 5850 km｜车记本');
  });

  it('标题长度受控，避免微信卡片截断', () => {
    const long = '一'.repeat(60);
    const title = buildShareMessage({ highlight: long }).title;
    // 微信分享卡片标题建议 ≤ 30 字，超长会截断显示
    expect(title.length).toBeLessThanOrEqual(30);
  });
});

describe('分享封面', () => {
  it('指向 5:4 专用封面而非方形 logo', () => {
    expect(buildShareMessage().imageUrl).toBe(SHARE_IMAGE);
    expect(SHARE_IMAGE).toBe('/assets/share-cover.png');
  });

  it('封面文件存在，且体积在微信 128KB 限制内', () => {
    const p = require('path').join('assets', 'share-cover.png');
    expect(fsx.existsSync(p)).toBe(true);
    const kb = fsx.statSync(p).size / 1024;
    expect(kb).toBeLessThanOrEqual(128);
  });
});

describe('朋友圈分享', () => {
  it('使用 query 而非 path（朋友圈不支持 path）', () => {
    const msg = buildTimelineMessage();
    expect(msg).toHaveProperty('query');
    expect(msg).not.toHaveProperty('path');
    expect(msg.title).toBe(DEFAULT_SHARE_TITLE);
  });

  it('标题规则与转发一致', () => {
    expect(buildTimelineMessage({ highlight: '已省 1200 元' }).title)
      .toBe('已省 1200 元｜车记本');
  });
});

describe('enableShareMenu 容错', () => {
  it('wx 未定义时不抛错（node 测试环境）', () => {
    expect(() => enableShareMenu()).not.toThrow();
  });

  it('wx.showShareMenu 存在时被调用一次', () => {
    const calls: any[] = [];
    (globalThis as any).wx = {
      showShareMenu: (opts: any) => calls.push(opts)
    };
    enableShareMenu();
    expect(calls.length).toBe(1);
    expect(calls[0].menus).toEqual(['shareAppMessage', 'shareTimeline']);
  });
});
