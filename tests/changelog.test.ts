// 更新日志：数据服务、NEW 小标逻辑、设置页入口、页面结构
//
// 三个容易翻车的点：
// ① meta 里已有 schemaVersion，写 lastSeenVersion 时必须合并——
//    整体覆盖会把迁移版本号抹掉，下次启动重跑迁移；
// ② NEW 的判定是「上次看过的版本 ≠ 最新」而不是「存在更新版本」，
//    否则降级安装（1.2.1 → 1.2.0）会误显示 NEW；
// ③ 新页面必须登记 page-smoke，否则「源码引用了未定义变量」只有真机白屏才暴露。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import {
  CHANGELOG,
  getLatestChangelogVersion,
  hasUnseenChangelog,
  markChangelogSeen
} from '../services/changelog.service';

const fsx = require('fs') as any;

function createMemoryStorage(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

describe('changelog 数据', () => {
  it('最新版本在数组最前，且至少包含当前版本 v1.2.1', () => {
    expect(CHANGELOG[0].ver).toBe('v1.2.1');
    expect(CHANGELOG.some(v => v.ver === 'v1.2.0')).toBe(true);
  });

  it('CHANGELOG[0].ver 与 package.json 版本同源（版本号的第 5 处来源，防漂移）', () => {
    // 其余四处（package.json / 关于页 / 设置页页脚 / 导出清单）由 release-audit-120.test.ts 锁定
    const pkg = JSON.parse(fsx.readFileSync('package.json', 'utf-8'));
    expect(getLatestChangelogVersion()).toBe(`v${pkg.version}`);
  });

  it('每个版本的条目都是纯文本（WXML 不解析 HTML，<b> 之类会原样显示）', () => {
    for (const entry of CHANGELOG) {
      for (const sec of entry.sections) {
        for (const item of sec.items) {
          expect(item).not.toMatch(/<[a-z]/i);
        }
      }
    }
  });

  it('分组名只用 新增 / 优化 / 修复 / 首个版本', () => {
    const allowed = ['新增', '优化', '修复', '首个版本'];
    for (const entry of CHANGELOG) {
      for (const sec of entry.sections) {
        expect(allowed).toContain(sec.title);
      }
    }
  });
});

describe('NEW 小标逻辑', () => {
  it('首次使用（未看过任何版本）→ 显示 NEW', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    expect(hasUnseenChangelog(adapter)).toBe(true);
  });

  it('看过最新版本 → 不再显示', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    markChangelogSeen(adapter);
    expect(hasUnseenChangelog(adapter)).toBe(false);
  });

  it('看过旧版本（降级安装）→ 仍显示 NEW', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    adapter.setMeta({ schemaVersion: 6, lastSeenVersion: 'v1.2.0' });
    expect(hasUnseenChangelog(adapter)).toBe(true);
  });

  it('写入 lastSeenVersion 时不覆盖 schemaVersion', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    adapter.setMeta({ schemaVersion: 6 });
    markChangelogSeen(adapter);
    expect(adapter.getMeta<any>().schemaVersion).toBe(6);
    expect(adapter.getMeta<any>().lastSeenVersion).toBe(getLatestChangelogVersion());
  });

  it('重复标记是幂等的（不会反复 touch meta）', () => {
    const adapter = new StorageAdapter(createMemoryStorage());
    markChangelogSeen(adapter);
    const before = adapter.getMeta<any>().lastSeenVersion;
    markChangelogSeen(adapter);
    expect(adapter.getMeta<any>().lastSeenVersion).toBe(before);
  });
});

describe('设置页入口', () => {
  const wxml: string = fsx.readFileSync('pages/user/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('pages/user/index.ts', 'utf-8');

  it('入口在「反馈与建议」之后、「关于」之前（帮助/信息组内）', () => {
    const feedback = wxml.indexOf('反馈与建议');
    const changelog = wxml.indexOf('更新日志');
    const about = wxml.indexOf('onOpenAbout');
    expect(changelog).toBeGreaterThan(feedback);
    expect(about).toBeGreaterThan(changelog);
  });

  it('NEW 小标由 changelogNew 控制，绑定 onOpenChangelog', () => {
    expect(wxml).toContain('wx:if="{{changelogNew}}"');
    expect(wxml).toContain('bindtap="onOpenChangelog"');
    expect(wxml).toContain('>NEW<');
  });

  it('点击跳转更新日志页；load 时计算 changelogNew', () => {
    expect(ts).toContain("url: '/pages/changelog/index'");
    expect(ts).toContain('hasUnseenChangelog(storage)');
    expect(ts).toContain('changelogNew: hasUnseenChangelog(storage)');
  });

  it('样式：badge 用主色胶囊，贴箭头（margin-left:auto）', () => {
    const wxss: string = fsx.readFileSync('pages/user/index.wxss', 'utf-8');
    const block = wxss.slice(wxss.indexOf('.row-badge'));
    expect(block).toContain('var(--color-primary)');
    expect(block).toContain('var(--color-primary-light)');
    expect(block).toContain('margin-left: auto');
  });
});

describe('更新日志页', () => {
  const wxml: string = fsx.readFileSync('pages/changelog/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('pages/changelog/index.ts', 'utf-8');

  it('app.json 已注册页面，page-smoke 已登记用例', () => {
    const appJson = JSON.parse(fsx.readFileSync('app.json', 'utf-8'));
    expect(appJson.pages).toContain('pages/changelog/index');
    const smoke = fsx.readFileSync('tests/page-smoke.test.ts', 'utf-8');
    expect(smoke).toContain("path: 'pages/changelog/index'");
  });

  it('首节点是 page-meta（跟随皮肤）', () => {
    expect(wxml.replace(/^\s+/, '').startsWith('<page-meta page-style="{{pageStyle}}" />')).toBe(true);
  });

  it('首个条目渲染「最新」标签，时间轴状态点区分新旧', () => {
    expect(wxml).toContain('index === 0 ? \'latest\'');
    expect(wxml).toContain('最新');
    expect(fsx.readFileSync('pages/changelog/index.wxss', 'utf-8')).toContain('.cl-item.latest .cl-dot');
  });

  it('打开页面即标记已看（onShow，与全站 storage 惯例一致）', () => {
    expect(ts).toContain('markChangelogSeen(getStorage())');
  });

  it('二级页底部留白遵循约定（无底栏：40rpx + 安全区）', () => {
    const wxss: string = fsx.readFileSync('pages/changelog/index.wxss', 'utf-8');
    expect(wxss).toContain('calc(40rpx + env(safe-area-inset-bottom))');
  });
});
