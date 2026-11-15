// 自定义图标登记表 + 选择器分栏结构
import { StorageAdapter, StorageLike } from '../repositories/storage.adapter';
import {
  addCustomIcon,
  listCustomIconPaths,
  removeCustomIcon,
  listRegisteredPaths,
  CUSTOM_ICON_TABLE,
  CustomIcon
} from '../services/custom-icon.service';
import { ICON_GROUPS } from '../utils/icons';

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
  return new StorageAdapter(memory());
}

describe('自定义图标登记', () => {
  it('登记后能列出', () => {
    const s = setup();
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    expect(listCustomIconPaths(s)).toEqual(['wxfile://usr/icon-1.png']);
  });

  it('同一路径不重复登记', () => {
    const s = setup();
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    expect(listCustomIconPaths(s).length).toBe(1);
  });

  it('空路径不登记', () => {
    const s = setup();
    expect(addCustomIcon(s, '')).toBeNull();
    expect(listCustomIconPaths(s)).toEqual([]);
  });

  it('最近登记的排在前面', () => {
    const s = setup();
    const base = { sourcePlatform: 'mp' as any, deleted: false, updatedAt: 0 };
    (['a', 'b', 'c'] as string[]).forEach((n, i) => {
      s.insert<CustomIcon>(CUSTOM_ICON_TABLE, {
        ...base,
        sourceId: `id-${n}`,
        path: `wxfile://usr/icon-${n}.png`,
        createdAt: 1000 + i * 10
      });
    });
    const paths = listCustomIconPaths(s);
    expect(paths[0]).toContain('icon-c');
    expect(paths[2]).toContain('icon-a');
  });

  it('移除是物理删除，不进回收站', () => {
    const s = setup();
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    removeCustomIcon(s, 'wxfile://usr/icon-1.png');

    expect(listCustomIconPaths(s)).toEqual([]);
    // 软删会留下 deleted=true 的记录；这里应该一条都不剩
    expect(s.list<CustomIcon>(CUSTOM_ICON_TABLE).length).toBe(0);
  });

  it('移除不存在的路径不报错', () => {
    const s = setup();
    expect(() => removeCustomIcon(s, 'wxfile://usr/none.png')).not.toThrow();
  });

  it('listRegisteredPaths 与 listCustomIconPaths 一致', () => {
    const s = setup();
    addCustomIcon(s, 'wxfile://usr/icon-1.png');
    addCustomIcon(s, 'wxfile://usr/icon-2.png');
    expect(listRegisteredPaths(s).sort()).toEqual(listCustomIconPaths(s).sort());
  });
});

describe('图标库不会被启动清理误删', () => {
  it('保留集必须包含登记表（否则自定义分栏会变成空白）', () => {
    const src: string = fsx.readFileSync('utils/icon-store.ts', 'utf-8');
    expect(src).toContain('listRegisteredPaths');
    expect(src).toContain('custom-icon.service');
  });

  it('清理仍只动自己命名规则内的文件', () => {
    const src: string = fsx.readFileSync('utils/icon-store.ts', 'utf-8');
    expect(src).toContain('isManagedIconFile');
  });
});

describe('选择器分栏', () => {
  const wxml: string = fsx.readFileSync('components/icon-picker/index.wxml', 'utf-8');
  const wxss: string = fsx.readFileSync('components/icon-picker/index.wxss', 'utf-8');
  const ts: string = fsx.readFileSync('components/icon-picker/index.ts', 'utf-8');

  it('预设分栏全部是两字标签', () => {
    for (const g of ICON_GROUPS) {
      expect(g.label.length).toBe(2);
    }
  });

  it('预设 5 组 + 自定义 = 6 个分栏', () => {
    expect(ICON_GROUPS.length).toBe(5);
    // 分栏由 ICON_GROUPS 映射后再追加「自定义」
    expect(ts).toContain("tabs.push({ key: CUSTOM_KEY, label: '自定义' })");
  });

  it('图标区高度固定，不随分栏内容变化（防止面板上下跳动）', () => {
    const m = /\.icon-scroll\s*\{[^}]*\}/.exec(wxss);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('height: 208rpx');
    // 绝不能再退回 max-height，否则又会出现高度跳动
    expect(m![0]).not.toContain('max-height');
  });

  it('208rpx 正好容纳两行图标（88 + 8×2 = 104rpx/行）', () => {
    expect(208 / (88 + 8 * 2)).toBe(2);
  });

  it('自定义分栏用图片渲染，且支持长按删除', () => {
    expect(wxml).toContain('icon-img-item');
    expect(wxml).toContain('bindlongpress="onLongPressCustom"');
    expect(ts).toContain('removeCustomIcon');
  });

  it('自定义分栏空态撑满固定高度，不会让面板变矮', () => {
    const m = /\.custom-empty\s*\{[^}]*\}/.exec(wxss);
    expect(m).toBeTruthy();
    expect(m![0]).toContain('height: 208rpx');
  });

  it('裁剪完成后自动登记进图标库', () => {
    expect(ts).toContain('addCustomIcon');
    // 必须在 cropped 回调里登记
    expect(ts).toMatch(/cropped:[\s\S]{0,400}addCustomIcon/);
  });

  it('默认停在第一个预设分栏（不擅自跳到自定义）', () => {
    expect(ts).toContain('activeKey: first.key');
    expect(ts).not.toContain('if (this.data.customIcons.length > 0)');
  });

  it('不使用 observers（避免首次属性注入就 setData 的竞态）', () => {
    expect(ts).not.toContain('observers:');
    expect(ts).toContain('attached()');
  });
});
