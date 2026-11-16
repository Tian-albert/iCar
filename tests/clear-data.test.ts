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

describe('推荐按钮的样式细节', () => {
  const fsx2 = require('fs') as any;
  const wxss: string = fsx2.readFileSync('pages/user/index.wxss', 'utf-8');

  it('button 外观完全重置（无默认边框/背景/内边距残留）', () => {
    const block = wxss.match(/\.share-btn \{[\s\S]*?\}/);
    expect(block).toBeTruthy();
    const css = block![0];
    expect(css).toContain('background: transparent');
    expect(css).toContain('border: none');
    // 微信 button 默认有一条 ::after 边框，必须显式去掉
    expect(wxss).toMatch(/\.share-btn::after \{[\s\S]{0,60}border: none/);
  });

  it('负外边距抵消 .card 内边距，与上面的 row 对齐', () => {
    const block = wxss.match(/\.share-btn \{[\s\S]*?\}/);
    // .card 有左右 padding，button 若不抵消会缩进、与 row 不对齐
    expect(block![0]).toMatch(/margin:\s*0\s+calc\(0rpx - var\(--sp-4\)\)/);
    expect(block![0]).toMatch(/padding:\s*0 var\(--sp-4\)/);
  });

  it('不使用渐变（用户明确要求与整体风格一致）', () => {
    expect(wxss).not.toContain('linear-gradient');
  });
});
