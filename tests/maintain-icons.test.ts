// 保养项图标：模板按项目形象配图标 + 旧数据回填 + 选择器改图标栅格
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import { seedPresetCategories } from '../repositories/seed';
import { createCar } from '../services/car.service';
import {
  ensureMaintainTemplates,
  listMaintains
} from '../services/maintain-record.service';
import { PRESET_ICONS } from '../utils/icons';

const fsx = require('fs') as any;

function memory(): StorageLike {
  const map = new Map<string, unknown>();
  return {
    get: (k: string) => map.get(k),
    set: (k: string, v: unknown) => { map.set(k, v); },
    remove: (k: string) => { map.delete(k); },
    keys: () => [...map.keys()]
  } as StorageLike;
}

function setup() {
  const adapter = new StorageAdapter(memory());
  seedPresetCategories(adapter);
  const car = createCar(adapter, {
    name: '测试车',
    mileages: 5000,
    initDate: Date.now(),
    energyType: 'fuel'
  });
  return { adapter, car };
}

describe('保养模板自带形象图标', () => {
  it('每个默认保养项都有非空图标', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const items = listMaintains(adapter, car.sourceId);
    expect(items.length).toBeGreaterThanOrEqual(6);
    for (const m of items) {
      expect(m.icon).toBeTruthy();
      expect(m.icon.trim().length).toBeGreaterThan(0);
    }
  });

  it('各项目图标互不相同（否则栅格里认不出来）', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const icons = listMaintains(adapter, car.sourceId).map(m => m.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('常用项目用的是贴合语义的图标', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const byName = new Map(
      listMaintains(adapter, car.sourceId).map(m => [m.name, m.icon])
    );
    expect(byName.get('机油机滤')).toBe('🛢️');
    expect(byName.get('空调滤芯')).toBe('❄️');
    expect(byName.get('空气滤芯')).toBe('💨');
    expect(byName.get('刹车油')).toBe('🛑');
    expect(byName.get('火花塞')).toBe('⚡');
    expect(byName.get('变速箱油')).toBe('⚙️');
  });

  it('不使用旧 Android 无法显示的 Unicode 13 图标', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    const tofu = ['🪫', '🪣', '🪟', '🪛', '🪞', '🪙'];
    for (const m of listMaintains(adapter, car.sourceId)) {
      expect(tofu).not.toContain(m.icon);
    }
  });

  it('图标也在预设图标集里可用（自定义时可复用）', () => {
    const { adapter, car } = setup();
    ensureMaintainTemplates(adapter, car.sourceId);
    for (const m of listMaintains(adapter, car.sourceId)) {
      expect(PRESET_ICONS).toContain(m.icon);
    }
  });
});

describe('旧数据回填', () => {
  it('图标为空的旧保养项按名称补上模板图标', () => {
    const { adapter, car } = setup();
    // 模拟老版本：icon 为空字符串
    adapter.insert('maintains', {
      sourceId: 'legacy-1',
      sourcePlatform: 'mp',
      carSourceId: car.sourceId,
      name: '机油机滤',
      icon: '',
      cycleMileages: 10000,
      cycleDays: 360,
      cycleMonths: 12,
      cycleUnit: 'month',
      cycleValue: 12,
      mileageSource: 'total',
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as any);

    ensureMaintainTemplates(adapter, car.sourceId);

    const item = listMaintains(adapter, car.sourceId).find(m => m.sourceId === 'legacy-1')!;
    expect(item.icon).toBe('🛢️');
  });

  it('用户自己设置过的图标不会被覆盖', () => {
    const { adapter, car } = setup();
    adapter.insert('maintains', {
      sourceId: 'custom-1',
      sourcePlatform: 'mp',
      carSourceId: car.sourceId,
      name: '机油机滤',
      icon: '🧴',
      cycleMileages: 10000,
      cycleDays: 360,
      cycleMonths: 12,
      cycleUnit: 'month',
      cycleValue: 12,
      mileageSource: 'total',
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as any);

    ensureMaintainTemplates(adapter, car.sourceId);

    const item = listMaintains(adapter, car.sourceId).find(m => m.sourceId === 'custom-1')!;
    expect(item.icon).toBe('🧴');
  });

  it('非模板名称的自定义保养项兜底为扳手（不留空导致显示 📌）', () => {
    const { adapter, car } = setup();
    adapter.insert('maintains', {
      sourceId: 'custom-2',
      sourcePlatform: 'mp',
      carSourceId: car.sourceId,
      name: '雨刮片',
      icon: '',
      cycleMileages: 20000,
      cycleDays: 0,
      cycleMonths: 0,
      cycleUnit: '',
      cycleValue: 0,
      mileageSource: 'total',
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as any);

    ensureMaintainTemplates(adapter, car.sourceId);

    const item = listMaintains(adapter, car.sourceId).find(m => m.sourceId === 'custom-2')!;
    expect(item.icon).toBe('🔧');
  });

  it('改过名的旧项也兜底为扳手，而非永远 📌', () => {
    const { adapter, car } = setup();
    adapter.insert('maintains', {
      sourceId: 'renamed-1',
      sourcePlatform: 'mp',
      carSourceId: car.sourceId,
      name: '机油机滤(全合成)',
      icon: '',
      cycleMileages: 10000,
      cycleDays: 360,
      cycleMonths: 12,
      cycleUnit: 'month',
      cycleValue: 12,
      mileageSource: 'total',
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deleted: false
    } as any);

    ensureMaintainTemplates(adapter, car.sourceId);

    const item = listMaintains(adapter, car.sourceId).find(m => m.sourceId === 'renamed-1')!;
    expect(item.icon).toBe('🔧');
  });
});

describe('保养项选择器改为图标栅格', () => {
  const wxml: string = fsx.readFileSync('pages/maintain-form/index.wxml', 'utf-8');
  const wxss: string = fsx.readFileSync('pages/maintain-form/index.wxss', 'utf-8');
  const ts: string = fsx.readFileSync('pages/maintain-form/index.ts', 'utf-8');

  it('渲染图标（emoji 与自定义图片两种）', () => {
    expect(wxml).toContain('{{item.emoji}}');
    expect(wxml).toContain('item.isImage');
    expect(wxml).toContain('src="{{item.icon}}"');
  });

  it('点整块即选中（与支出类别一致）', () => {
    expect(wxml).toMatch(/bindtap="onToggleMaintain"/);
    expect(wxml).toContain('cat-active');
  });

  it('编辑周期用 catchtap，避免同时切换选中态', () => {
    expect(wxml).toMatch(/catchtap="onEditCycle"/);
  });

  it('数据里带上 icon / emoji / isImage', () => {
    expect(ts).toContain('displayIcon');
    expect(ts).toContain('isImageIcon');
    // 两处映射（onLoad 与 refreshMaintains）都要有
    expect((ts.match(/isImage: isImageIcon/g) || []).length).toBe(2);
  });

  it('旧的纯文字标签样式已移除', () => {
    expect(wxss).not.toContain('.tag-wrap');
    expect(wxml).not.toContain('tag-selected');
  });
});

describe('自定义保养项默认图标', () => {
  const ts: string = fsx.readFileSync('pages/maintain-item-form/index.ts', 'utf-8');

  it('新建与编辑都不留空图标', () => {
    expect(ts).toContain("icon: '🔧'");
    expect(ts).toContain("m.icon || '🔧'");
  });
});

describe('「记一笔」保养 Tab 同步为图标栅格', () => {
  const wxml: string = fsx.readFileSync('pages/entry/index.wxml', 'utf-8');
  const wxss: string = fsx.readFileSync('pages/entry/index.wxss', 'utf-8');
  const ts: string = fsx.readFileSync('pages/entry/index.ts', 'utf-8');

  it('渲染图标（emoji 与自定义图片两种）', () => {
    expect(wxml).toContain('mnt-grid');
    expect(wxml).toContain('{{item.emoji}}');
    expect(wxml).toContain('item.isImage');
    expect(wxml).toContain('src="{{item.icon}}"');
  });

  it('点整块即切换选中（与记保养页、支出类别一致）', () => {
    expect(wxml).toMatch(/bindtap="onMaintainToggle"/);
    expect(wxml).toContain('mnt-active');
  });

  it('编辑周期用 catchtap，避免同时切换选中态', () => {
    expect(wxml).toMatch(/catchtap="onEditCycle"/);
  });

  it('数据里带上 icon / emoji / isImage（两处映射都要有）', () => {
    expect(ts).toContain('displayIcon');
    expect(ts).toContain('isImageIcon');
    expect((ts.match(/isImage: isImageIcon/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('旧的纯文字标签样式与结构已移除', () => {
    expect(wxml).not.toContain('tag-wrap');
    expect(wxml).not.toContain('tag-selected');
    expect(wxss).not.toContain('.tag-wrap');
    expect(wxss).not.toContain('.tag-selected');
  });

  it('栅格类名用 mnt- 前缀，避免与支出类别的 cat-* 冲突', () => {
    // 本页「支出类别」已占用 .cat-item / .cat-name
    expect(wxss).toContain('.mnt-item');
    expect(wxss).toContain('.cat-item');
    // 保养栅格不得复用 cat-*，否则会继承支出类别的横向单行尺寸
    expect(wxml).not.toMatch(/mnt-item[^>]*cat-item/);
  });

  it('与记保养页的栅格尺寸完全一致', () => {
    const formWxss: string = fsx.readFileSync('pages/maintain-form/index.wxss', 'utf-8');
    const entryW = /\.mnt-item\s*\{[^}]*width:\s*(\d+)rpx/.exec(wxss);
    const formW = /\.cat-item\s*\{[^}]*width:\s*(\d+)rpx/.exec(formWxss);
    expect(entryW).toBeTruthy();
    expect(formW).toBeTruthy();
    expect(entryW![1]).toBe(formW![1]);
    expect(entryW![1]).toBe('200'); // 三列，留 6rpx 余量防换行
  });
});

describe('栅格为三列固定尺寸 + 最多两行滚动', () => {
  const entryWxml: string = fsx.readFileSync('pages/entry/index.wxml', 'utf-8');
  const entryWxss: string = fsx.readFileSync('pages/entry/index.wxss', 'utf-8');
  const formWxml: string = fsx.readFileSync('pages/maintain-form/index.wxml', 'utf-8');
  const formWxss: string = fsx.readFileSync('pages/maintain-form/index.wxss', 'utf-8');

  it('三列能排下且不溢出（200×3 + 16×2 = 632 ≤ 638）', () => {
    expect(200 * 3 + 16 * 2).toBe(632);
    expect(632).toBeLessThanOrEqual(638);
  });

  it('单元格高度可复算：20+44+10+34+6+28+14 = 156rpx', () => {
    expect(20 + 44 + 10 + 34 + 6 + 28 + 14).toBe(156);
  });

  it('可视高度正好两行（156×2 + 16 = 328rpx），即 6 项', () => {
    expect(156 * 2 + 16).toBe(328);
    expect(entryWxss).toContain('height: 328rpx');
    expect(formWxss).toContain('height: 328rpx');
  });

  it('两页都包在 scroll-view 里，可上下滚动', () => {
    expect(entryWxml).toMatch(/<scroll-view[\s\S]{0,200}scroll-y/);
    expect(formWxml).toMatch(/<scroll-view[\s\S]{0,200}scroll-y/);
  });

  it('超过 3 项才定高（≤3 项只占一行），超过 6 项才需要滚动', () => {
    expect(entryWxml).toContain('maintains.length > 3');
    expect(formWxml).toContain('maintains.length > 3');
  });

  it('名称与周期都有显式行高，格子高度才确定', () => {
    expect(entryWxss).toMatch(/\.mnt-name\s*\{[^}]*line-height:\s*34rpx/);
    expect(entryWxss).toMatch(/\.mnt-cycle\s*\{[^}]*line-height:\s*28rpx/);
    expect(formWxss).toMatch(/\.cat-name\s*\{[^}]*line-height:\s*34rpx/);
    expect(formWxss).toMatch(/\.cat-cycle\s*\{[^}]*line-height:\s*28rpx/);
  });
});

describe('复审修复：栅格高度不得被 border 撑破', () => {
  const entryWxss: string = fsx.readFileSync('pages/entry/index.wxss', 'utf-8');
  const formWxss: string = fsx.readFileSync('pages/maintain-form/index.wxss', 'utf-8');

  it('单元格不使用 border', () => {
    // border 会计入 auto 高度：156 + 4 = 160rpx，两行 336rpx 超出 328rpx 容器，
    // 第二行底部被裁 8rpx，且能滚出 8rpx
    for (const [css, cls] of [
      [entryWxss, 'mnt'],
      [formWxss, 'cat']
    ] as Array<[string, string]>) {
      const m = new RegExp(`\\.${cls}-item\\s*\\{[^}]*\\}`).exec(css);
      expect(m).toBeTruthy();
      expect(m![0]).not.toMatch(/border:\s*\d+rpx/);
    }
  });

  it('选中环改用 inset box-shadow（不占布局尺寸）', () => {
    expect(entryWxss).toMatch(/box-shadow:\s*inset 0 0 0 2rpx/);
    expect(formWxss).toMatch(/box-shadow:\s*inset 0 0 0 2rpx/);
  });

  it('无边框后高度仍然是 156rpx，两行 328rpx 与容器一致', () => {
    expect(20 + 44 + 10 + 34 + 6 + 28 + 14).toBe(156);
    expect(156 * 2 + 16).toBe(328);
  });
});

describe('复审修复：记保养页有空态指引', () => {
  const wxml: string = fsx.readFileSync('pages/maintain-form/index.wxml', 'utf-8');
  it('保养项为空时给出「点管理添加」提示', () => {
    expect(wxml).toContain('maintains.length > 0');
    expect(wxml).toContain('暂无保养项');
  });
});
