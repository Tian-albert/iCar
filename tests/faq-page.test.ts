// 常见问题页（FAQ）的回归测试。
//
// 重点验证三件事：
// 1. 折叠逻辑正确（同时只开一条、再点收起）
// 2. 底部反馈入口真的能复制邮箱
// 3. 页面结构符合「二级页」约定（无底栏、底部留白按二级页）
import {
  installWx,
  resetStorage,
  loadPage,
  makePageInstance
} from './helpers/page-harness';

const fsx = require('fs') as any;

const ts: string = fsx.readFileSync('pages/faq/index.ts', 'utf-8');
const wxml: string = fsx.readFileSync('pages/faq/index.wxml', 'utf-8');
const wxss: string = fsx.readFileSync('pages/faq/index.wxss', 'utf-8');
const json = JSON.parse(fsx.readFileSync('pages/faq/index.json', 'utf-8'));
const app = JSON.parse(fsx.readFileSync('app.json', 'utf-8'));

function makeFaq() {
  const cfg = loadPage('pages/faq/index');
  return { cfg, inst: makePageInstance(cfg) };
}

beforeEach(() => {
  resetStorage();
  installWx();
});

describe('FAQ：已正确注册', () => {
  it('在 app.json 的 pages 里', () => {
    expect(app.pages).toContain('pages/faq/index');
  });

  it('四个文件齐全且标题是「常见问题」', () => {
    ['index.ts', 'index.wxml', 'index.wxss', 'index.json'].forEach(f => {
      expect(fsx.existsSync(`pages/faq/${f}`)).toBe(true);
    });
    expect(json.navigationBarTitleText).toBe('常见问题');
  });
});

describe('FAQ：折叠交互', () => {
  it('初始全部收起', () => {
    const { inst } = makeFaq();
    expect(inst.data.openKey).toBe('');
  });

  it('点标题展开对应条目', () => {
    const { cfg, inst } = makeFaq();
    cfg.onToggle.call(inst, { currentTarget: { dataset: { key: '0-1' } } });
    expect(inst.data.openKey).toBe('0-1');
  });

  it('再点同一条则收起', () => {
    const { cfg, inst } = makeFaq();
    cfg.onToggle.call(inst, { currentTarget: { dataset: { key: '0-1' } } });
    cfg.onToggle.call(inst, { currentTarget: { dataset: { key: '0-1' } } });
    expect(inst.data.openKey).toBe('');
  });

  it('点另一条时，前一条自动收起（同时只开一条）', () => {
    const { cfg, inst } = makeFaq();
    cfg.onToggle.call(inst, { currentTarget: { dataset: { key: '0-0' } } });
    expect(inst.data.openKey).toBe('0-0');
    cfg.onToggle.call(inst, { currentTarget: { dataset: { key: '2-1' } } });
    expect(inst.data.openKey).toBe('2-1');
  });
});

describe('FAQ：内容', () => {
  it('分为 3 组共 8 条（数据 3 + 油耗 3 + 保养 2）', () => {
    const { inst } = makeFaq();
    const groups = inst.data.groups;
    expect(groups.length).toBe(3);
    expect(groups[0].items.length).toBe(3);
    expect(groups[1].items.length).toBe(3);
    expect(groups[2].items.length).toBe(2);
    const total = groups.reduce((n: number, g: any) => n + g.items.length, 0);
    expect(total).toBe(8);
  });

  it('每组都有标题，每条都有问题与答案', () => {
    const { inst } = makeFaq();
    inst.data.groups.forEach((g: any) => {
      expect(g.title.trim().length).toBeGreaterThan(0);
      g.items.forEach((it: any) => {
        expect(it.q.trim().length).toBeGreaterThan(0);
        expect(it.a.trim().length).toBeGreaterThan(0);
        // 答案不能是「请联系客服」这类废话
        expect(it.a).not.toContain('联系客服');
      });
    });
  });

  it('答案里给出具体操作路径（含「」引用的界面名称）', () => {
    const { inst } = makeFaq();
    const all = inst.data.groups
      .reduce((acc: any[], g: any) => acc.concat(g.items), [])
      .map((it: any) => it.a)
      .join('');
    // 至少多处引用了实际界面路径，而不是空泛描述
    const quoted = (all.match(/「[^」]+」/g) || []).length;
    expect(quoted).toBeGreaterThanOrEqual(5);
  });
});

describe('FAQ：底部反馈入口', () => {
  it('点击后复制反馈邮箱并提示', () => {
    const setClipboardData = jest.fn((o: any) => { if (o.success) o.success(); });
    installWx({ setClipboardData });

    const { cfg, inst } = makeFaq();
    cfg.onFeedback.call(inst);

    expect(setClipboardData).toHaveBeenCalledTimes(1);
    const arg = setClipboardData.mock.calls[0][0];
    expect(typeof arg.data).toBe('string');
    expect(arg.data).toContain('@');
  });

  it('WXML 里有「没找到答案」的引导文案', () => {
    expect(wxml).toContain('没找到答案');
    expect(wxml).toContain('bindtap="onFeedback"');
  });
});

describe('FAQ：二级页约定（无底栏）', () => {
  it('不在 tabBar 列表里', () => {
    const paths = app.tabBar.list.map((x: any) => x.pagePath);
    expect(paths).not.toContain('pages/faq/index');
  });

  it('底部留白按二级页处理（40rpx + 安全区，不是 168rpx）', () => {
    // calc() 里嵌了 env()，括号要一起匹配，不能用 [^)]+
    const m = wxss.match(/padding-bottom:\s*calc\((.*?)\);/);
    expect(m).toBeTruthy();
    expect(m![1]).toContain('env(safe-area-inset-bottom)');
    const num = m![1].match(/(\d+)rpx/);
    expect(num).toBeTruthy();
    // 二级页没有悬浮底栏，不需要为它留 108rpx
    expect(parseInt(num![1], 10)).toBeLessThan(108);
  });

  it('页面里没有引用底栏组件', () => {
    expect(wxml).not.toContain('tab-bar');
    expect(json.usingComponents).toEqual({});
  });
});

describe('FAQ：列表 key 稳定', () => {
  it('wx:key 不用下标，也不用可能重复的问题文本作为唯一依据', () => {
    // 分组用 title 作 key（组标题唯一）
    expect(wxml).toContain('wx:key="title"');
    // 条目用 q 作 key（同一组内问题文本不重复）
    expect(wxml).toContain('wx:key="q"');
    // 不能出现裸的 wx:key="index" 或 "*this"
    expect(wxml).not.toContain('wx:key="index"');
    expect(wxml).not.toContain('wx:key="*this"');
  });

  it('展开状态的 key 格式与 WXML 里的拼接一致', () => {
    // TS 里存 '组序号-项序号'，WXML 里用 gi + '-' + ii 比较
    expect(ts).toContain("openKey: ''");
    expect(wxml).toContain("openKey === gi + '-' + ii");
  });
});

describe('设置页：新增的「常见问题」入口', () => {
  const userWxml: string = fsx.readFileSync('pages/user/index.wxml', 'utf-8');
  const userTs: string = fsx.readFileSync('pages/user/index.ts', 'utf-8');

  it('入口文案与跳转方法都存在', () => {
    expect(userWxml).toContain('常见问题');
    expect(userWxml).toContain('bindtap="onOpenFaq"');
    expect(userTs).toContain('/pages/faq/index');
  });

  it('位置在「反馈与建议」与「关于」之间', () => {
    const feedback = userWxml.indexOf('反馈与建议');
    const faq = userWxml.indexOf('常见问题');
    const about = userWxml.indexOf('>关于<');
    expect(feedback).toBeGreaterThan(-1);
    expect(faq).toBeGreaterThan(feedback);
    expect(about).toBeGreaterThan(faq);
  });
});

describe('设置页：标题与底栏文案已改为「设置」', () => {
  const userJson = JSON.parse(fsx.readFileSync('pages/user/index.json', 'utf-8'));
  const tabTs: string = fsx.readFileSync('custom-tab-bar/index.ts', 'utf-8');

  it('页面标题是「设置」', () => {
    expect(userJson.navigationBarTitleText).toBe('设置');
  });

  it('底栏第三个 tab 文案是「设置」、图标是 gear', () => {
    expect(tabTs).toContain("text: '设置'");
    expect(tabTs).toContain("icon: 'gear'");
    expect(tabTs).not.toContain("text: '我的'");
    expect(tabTs).not.toContain("icon: 'user'");
  });

  it('app.json 的 tabBar 文案同步', () => {
    const mine = app.tabBar.list.filter((x: any) => x.pagePath === 'pages/user/index')[0];
    expect(mine.text).toBe('设置');
  });

  it('删除确认文案里的路径指引同步为「设置 → 回收站」', () => {
    ['pages/maintain-manage/index.ts', 'pages/records/index.ts', 'pages/vehicle-form/index.ts']
      .forEach(p => {
        const src: string = fsx.readFileSync(p, 'utf-8');
        expect(src).not.toContain('「我的 → 回收站」');
        expect(src).toContain('「设置 → 回收站」');
      });
  });
});
