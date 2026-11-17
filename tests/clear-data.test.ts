// 「清除所有数据」：物理清空业务表（含回收站），但保留 user 与 meta。
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar, listCars } from '../services/car.service';
import { saveCost, listCosts } from '../services/cost.service';
import { clearAllData } from '../services/clear-data.service';
import { TABLES } from '../store/index';
import { Category, Cost } from '../types/models';

const fsx = require('fs') as any;

function memory(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: k => map.get(k),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

/** 造一个有车、有记录、有回收站内容的库 */
function buildLibrary() {
  const a = new StorageAdapter(memory());
  seedPresetCategories(a);

  const car = createCar(a, {
    name: '测试车',
    mileages: 1000,
    initDate: Date.now(),
    energyType: 'fuel'
  });

  const cat = a.list<Category>('categories').filter(c => !c.presetType)[0];
  saveCost(a, {
    carSourceId: car.sourceId,
    categorySourceId: cat.sourceId,
    amount: 100,
    costDate: Date.now()
  });

  // 再插一条已软删的（模拟回收站内容）
  const now = Date.now();
  a.insert<Cost>('costs', {
    sourceId: 'trash-cost',
    sourcePlatform: 'mp',
    carSourceId: car.sourceId,
    categorySourceId: cat.sourceId,
    amount: 50,
    costDate: now,
    remark: '已删除的',
    maintainHandleSourceId: '',
    repairSourceId: '',
    fuelRecordSourceId: '',
    createdAt: now,
    updatedAt: now,
    deleted: true,
    deletedAt: now,
    deleteBatch: 'trash-cost'
  } as Cost);

  return { adapter: a, car };
}

describe('clearAllData：物理清空', () => {
  it('清空后所有业务表都为空', () => {
    const { adapter } = buildLibrary();
    const r = clearAllData(adapter);

    expect(r.ok).toBe(true);
    expect(r.removed).toBeGreaterThan(0);

    for (const table of [
      TABLES.cars,
      TABLES.categories,
      TABLES.maintains,
      TABLES.costs,
      TABLES.repairRecords,
      TABLES.fuelRecords,
      TABLES.fuelConsumptions,
      TABLES.customIcons
    ]) {
      expect(adapter.list(table).length).toBe(0);
    }
  });

  it('回收站内容也一并清掉（不留软删记录）', () => {
    const { adapter } = buildLibrary();
    // 清空前确认回收站里确实有东西
    expect(adapter.list<Cost>('costs').filter(c => c.deleted).length).toBe(1);

    clearAllData(adapter);

    // 连软删记录都不能留下
    expect(adapter.list('costs').length).toBe(0);
  });

  it('清空后 listCars / listCosts 都是空数组', () => {
    const { adapter } = buildLibrary();
    clearAllData(adapter);
    expect(listCars(adapter).length).toBe(0);
    expect(listCosts(adapter).length).toBe(0);
  });

  it('保留 user（会员、提醒开关、已初始化标记）', () => {
    const { adapter } = buildLibrary();
    const before = adapter.getUser()!;
    expect(before).toBeTruthy();

    clearAllData(adapter);

    const after = adapter.getUser()!;
    expect(after).toBeTruthy();
    expect(after.categoriesSeeded).toBe(before.categoriesSeeded);
    expect(after.memberLevel).toBe(before.memberLevel);
    expect(after.remindEnabled).toBe(before.remindEnabled);
  });

  it('保留 meta（schemaVersion），避免清空后重复迁移', () => {
    const { adapter } = buildLibrary();
    const metaBefore = adapter.getMeta();
    clearAllData(adapter);
    expect(adapter.getMeta()).toEqual(metaBefore);
  });

  it('清空后重建预设不会复活已删的支出预设', () => {
    // categoriesSeeded 保留 → 支出预设不会重建
    const { adapter } = buildLibrary();
    clearAllData(adapter);
    seedPresetCategories(adapter);

    const names = adapter.list<Category>('categories').map(c => c.name);
    // 系统预设始终存在（自动归类依赖）
    expect(names).toContain('加油');
    expect(names).toContain('保养');
    // 支出预设不重建
    expect(names).not.toContain('停车');
  });

  it('索引不留悬空 id（list 不返回 undefined 项）', () => {
    const { adapter } = buildLibrary();
    clearAllData(adapter);

    for (const table of [TABLES.cars, TABLES.costs, TABLES.categories]) {
      const items = adapter.list(table);
      for (const item of items) {
        expect(item).toBeTruthy();
      }
      expect(items.length).toBe(0);
    }
  });

  it('空库调用不报错，removed 为 0', () => {
    const a = new StorageAdapter(memory());
    const r = clearAllData(a);
    expect(r.ok).toBe(true);
    expect(r.removed).toBe(0);
  });
});

describe('「我的」页的界面契约', () => {
  const wxml: string = fsx.readFileSync('pages/user/index.wxml', 'utf-8');
  const ts: string = fsx.readFileSync('pages/user/index.ts', 'utf-8');
  const wxss: string = fsx.readFileSync('pages/user/index.wxss', 'utf-8');

  it('登录卡片已删除（不再有头像/昵称）', () => {
    expect(wxml).not.toContain('user-card');
    expect(wxml).not.toContain('user-avatar');
    expect(wxml).not.toContain('nickname');
    expect(ts).not.toContain('nickname');
  });

  it('有「清除所有数据」且为红色危险样式', () => {
    expect(wxml).toContain('清除所有数据');
    expect(wxml).toContain('row-danger');
    expect(wxss).toMatch(/\.row-danger[\s\S]{0,80}--color-danger/);
  });

  it('「清除所有数据」单独成组（不与普通设置混排）', () => {
    // 它所在的 card 里没有其他 row-label
    const blocks = wxml.split('<view class="card">');
    const clearBlock = blocks.find(b => b.indexOf('清除所有数据') >= 0)!;
    expect(clearBlock).toBeTruthy();
    const rows = clearBlock.split('class="row"').length - 1;
    expect(rows).toBe(1);
  });

  it('「把车记本推荐给朋友」单独成组、放在最下、且不用蓝色渐变', () => {
    expect(wxml).toContain('把车记本推荐给朋友');
    // 用 button + open-type="share"
    expect(wxml).toMatch(/open-type="share"/);
    // 位置在「关于」之后
    expect(wxml.indexOf('把车记本推荐给朋友')).toBeGreaterThan(wxml.indexOf('关于'));
    // 不用渐变（用户明确要求与整体风格一致）
    expect(wxss).not.toContain('linear-gradient');
  });

  it('清除前必须二次确认，文案说明不可撤销并建议备份', () => {
    expect(ts).toContain('showModal');
    expect(ts).toContain('不可撤销');
    expect(ts).toContain('备份');
    expect(ts).toContain("confirmColor: '#F5474F'");
  });

  it('清除后自动跳回「概览」页', () => {
    expect(ts).toContain("wx.switchTab({ url: '/pages/reminder/index' })");
  });

  it('清除失败时如实告知，不伪装成功', () => {
    expect(ts).toContain('if (!result.ok)');
    expect(ts).toContain('清除未完成');
  });
});

describe('推荐项的样式细节', () => {
  const fsx2 = require('fs') as any;
  const wxss: string = fsx2.readFileSync('pages/user/index.wxss', 'utf-8');
  const wxml: string = fsx2.readFileSync('pages/user/index.wxml', 'utf-8');

  it('视觉复用 .row / .row-label / .row-arrow，与「关于」同一套类', () => {
    // 这是「字体、位置必须一致」的根本保证：
    // 不是靠覆盖 button 样式去「凑」成一样，而是用同一个类
    const block = wxml.match(/<view class="row row-share">[\s\S]*?<\/view>\s*<\/view>/);
    expect(block).toBeTruthy();
    expect(block![0]).toContain('class="row-label"');
    expect(block![0]).toContain('class="row-arrow"');
    expect(block![0]).toContain('把车记本推荐给朋友');
  });

  it('button 只做透明覆盖层，不承载任何可见内容', () => {
    const btn = wxml.match(/<button class="share-cover"[^>]*>/);
    expect(btn).toBeTruthy();
    // 自闭合，内部没有文字/子节点 —— 避免 button 内置样式影响视觉
    expect(btn![0]).toContain('open-type="share"');
    expect(btn![0]).toMatch(/\/>$/);
    // 文案不能在 button 里面
    expect(btn![0]).not.toContain('把车记本推荐给朋友');
  });

  it('覆盖层用 inset 铺满整行（width:100% 压不住 button 内置尺寸）', () => {
    const cover = wxss.match(/\.share-cover \{[\s\S]*?\}/);
    expect(cover).toBeTruthy();
    const css = cover![0];
    expect(css).toMatch(/position:\s*absolute/);
    // inset 四边归零，比 width/height:100% 更能压住 button 的默认尺寸
    expect(css).toMatch(/top:\s*0/);
    expect(css).toMatch(/right:\s*0/);
    expect(css).toMatch(/bottom:\s*0/);
    expect(css).toMatch(/left:\s*0/);
    expect(css).toMatch(/z-index:\s*1/);
  });

  it('覆盖层**不使用 opacity**（接近 0 的透明度会被判为不可交互）', () => {
    const cover = wxss.match(/\.share-cover \{[\s\S]*?\}/);
    const css = cover![0];
    // 这是真机 bug 的根因：opacity: 0.01 让渲染层跳过命中测试，
    // 结果只有文字区域能点。必须靠 transparent 背景隐形，而不是透明度。
    expect(css).not.toMatch(/opacity:/);
    expect(css).toMatch(/background:\s*transparent/);
    expect(css).toMatch(/color:\s*transparent/);
    // 空 button 不被内置行高撑开
    expect(css).toMatch(/font-size:\s*0/);
  });

  it('覆盖层去掉 button 默认 ::after 边框', () => {
    expect(wxss).toMatch(/\.share-cover::after \{[\s\S]{0,40}border:\s*none/);
  });

  it('行容器为覆盖层提供定位参照', () => {
    const row = wxss.match(/\.row-share \{[\s\S]*?\}/);
    expect(row).toBeTruthy();
    expect(row![0]).toMatch(/position:\s*relative/);
  });

  it('不再依赖覆盖 button 内置样式（旧方案已废弃）', () => {
    // 在 button 上写 font-weight/text-align 覆盖实测在真机不生效，
    // 所以这些类不应再出现，避免有人又改回去
    expect(wxss).not.toContain('.share-btn');
    expect(wxss).not.toContain('.share-inner');
  });

  it('字号与普通选项一致（row-label 是 28rpx）', () => {
    const label = wxss.match(/\.row-label \{[\s\S]*?\}/);
    expect(label).toBeTruthy();
    expect(label![0]).toMatch(/font-size:\s*28rpx/);
    // 加粗只应出现在「不想要」的地方之外：row-label 本身不加粗
    expect(label![0]).not.toMatch(/font-weight:\s*(bold|700)/);
  });

  it('不使用渐变（用户明确要求与整体风格一致）', () => {
    expect(wxss).not.toContain('linear-gradient');
  });
});
