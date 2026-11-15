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

  it('非模板名称的自定义保养项保持不动', () => {
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
    expect(item.icon).toBe('');
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

  it('与记保养页的栅格尺寸一致（每行 3 个）', () => {
    const formWxss: string = fsx.readFileSync('pages/maintain-form/index.wxss', 'utf-8');
    const entryW = /\.mnt-item\s*\{[^}]*width:\s*(\d+)rpx/.exec(wxss);
    const formW = /\.cat-item\s*\{[^}]*width:\s*(\d+)rpx/.exec(formWxss);
    expect(entryW).toBeTruthy();
    expect(formW).toBeTruthy();
    expect(entryW![1]).toBe(formW![1]);
  });
});
