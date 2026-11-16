// 1.2.0 发布前审计修复的回归测试
//
// 覆盖的都是「只在真机/特定数据下才暴露」的问题：
// 图标被当文本渲染、环图中心溢字、空数据残留旧图、百分比凑不满 100%、
// 滚动时序、裁剪页异常兜底。
const fsx = require('fs') as any;

function read(p: string): string {
  return fsx.readFileSync(p, 'utf-8');
}

import { toIntegerPercents } from '../services/overview.service';
import { PRESET_ICONS } from '../utils/icons';

describe('整数百分比必须合计 100', () => {
  it('三项各 33.33% 时不会只显示 99%', () => {
    const out = toIntegerPercents([33.3, 33.3, 33.3]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('差额补给占比最大的那一项', () => {
    // 55.3 / 26.8 / 17.9 → 55 / 27 / 18，合计 100，最大项仍是 55
    const out = toIntegerPercents([55.3, 26.8, 17.9]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out[0]).toBe(55);
  });

  it('已经是 100 时不做任何调整', () => {
    expect(toIntegerPercents([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it('单项 100%', () => {
    expect(toIntegerPercents([100])).toEqual([100]);
  });

  it('空数组不报错', () => {
    expect(toIntegerPercents([])).toEqual([]);
  });

  it('非法数值按 0 处理，不产生 NaN', () => {
    const out = toIntegerPercents([NaN, 60, 40]);
    expect(out.some(v => isNaN(v))).toBe(false);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('自定义图标必须走 <image>，不能当文本渲染', () => {
  // 自定义图标是 wxfile:// 路径，用 {{item.emoji}} 输出会把整串路径显示出来
  const pages = [
    { ts: 'pages/entry/index.ts', wxml: 'pages/entry/index.wxml' },
    { ts: 'pages/cost-form/index.ts', wxml: 'pages/cost-form/index.wxml' },
    { ts: 'pages/records/index.ts', wxml: 'pages/records/index.wxml' },
    { ts: 'pages/vehicle-detail/index.ts', wxml: 'pages/vehicle-detail/index.wxml' }
  ];

  for (const p of pages) {
    it(`${p.wxml} 含 isImage 分支`, () => {
      const wxml = read(p.wxml);
      expect(wxml).toContain('item.isImage');
      expect(wxml).toContain('src="{{item.icon}}"');
    });

    it(`${p.ts} 提供 icon 与 isImage 字段`, () => {
      const ts = read(p.ts);
      expect(ts).toContain('isImageIcon');
      expect(ts).toContain('isImage:');
      // 不允许再出现「只给 emoji 不给 isImage」的写法
      expect(ts).not.toContain('iconEmoji(');
    });
  }
});

describe('概览页环图', () => {
  const ts = read('components/tab-overview/index.ts');
  const wxml = read('components/tab-overview/index.wxml');
  const wxss = read('components/tab-overview/index.wxss');

  it('无数据时也会重设画布尺寸（否则残留上一次的环图）', () => {
    // canvas.width 赋值必须在「无 segments 就 return」之前
    const widthIdx = ts.indexOf('canvas.width = DONUT_SIZE * dpr');
    const emptyIdx = ts.indexOf('if (!segments.length)');
    expect(widthIdx).toBeGreaterThan(0);
    expect(emptyIdx).toBeGreaterThan(0);
    expect(widthIdx).toBeLessThan(emptyIdx);
  });

  it('中心金额按实际测量宽度缩字号（不靠字符数估算）', () => {
    expect(ts).toContain('measureText');
    expect(ts).toContain('computeDonutLayout');
    expect(ts).toContain('innerR');
  });

  it('无支出时显示空态并收起画布，而不是显示一排 ¥0', () => {
    expect(wxml).toContain('hasYearCost');
    expect(wxml).toContain('今年还没有支出记录');
    expect(wxss).toContain('donut-idle');
  });

  it('图例百分比走 toIntegerPercents', () => {
    expect(ts).toContain('toIntegerPercents');
  });
});

describe('详情页滚动时序', () => {
  const ts = read('pages/vehicle-detail/index.ts');

  it('scrollToSection 在 setData 回调里调用', () => {
    expect(ts).toMatch(/\},\s*\(\)\s*=>\s*\{[\s\S]{0,200}this\.scrollToSection\(\)/);
  });

  it('不再依赖 wx.nextTick 做滚动', () => {
    expect(ts).not.toContain('wx.nextTick');
  });
});

describe('裁剪页异常兜底', () => {
  const ts = read('pages/icon-crop/index.ts');

  it('decodeURIComponent 有 try/catch（含非法 % 时不会白屏）', () => {
    expect(ts).toMatch(/try\s*\{[\s\S]{0,160}decodeURIComponent/);
  });

  it('导出有超时兜底（否则 loading 遮罩可能永久锁页）', () => {
    expect(ts).toContain('export timeout');
    expect(ts).toMatch(/setTimeout\([\s\S]{0,120}finish\(reject/);
  });

  it('落盘失败必须抛错，不能退回临时路径并登记进图标库', () => {
    const persist = /persistIcon\(tempPath: string\): string \{[\s\S]*?\n  \}/.exec(ts);
    expect(persist).toBeTruthy();
    // 文件里不能再出现「catch 后 return tempPath」
    expect(persist![0]).not.toContain('return tempPath');
  });

  it('双指抬一指时重置拖动起点（避免画面跳一下）', () => {
    expect(ts).toMatch(/onTouchEnd\([\s\S]{0,600}t\.length === 1/);
  });
});

describe('自定义图标删除前检查占用', () => {
  const picker = read('components/icon-picker/index.ts');
  const svc = read('services/custom-icon.service.ts');

  it('服务层提供 countIconUsage', () => {
    expect(svc).toContain('export function countIconUsage');
  });

  it('长按删除先查占用，占用中直接拒绝', () => {
    expect(picker).toContain('countIconUsage');
    expect(picker).toContain('该图标正在使用中');
    // 提示语必须与实际行为一致，不能承诺「会变回默认图标」
    expect(picker).not.toContain('会变回默认图标');
  });
});

describe('图标集不再包含旧 Android 无法显示的字符', () => {
  it('实际图标列表不含 Unicode 13 图标（注释里提到不算）', () => {
    // 断言数据本身，而不是源文件文本——源文件注释里会举例说明这些字符
    for (const bad of ['🪫', '🪣', '🪟', '🪛', '🪞', '🪙']) {
      expect(PRESET_ICONS).not.toContain(bad);
    }
  });
});

describe('版本号 1.2.0 四处一致', () => {
  it('package.json / 关于页 / 我的页 / 导出清单', () => {
    expect(JSON.parse(read('package.json')).version).toBe('1.2.0');
    expect(read('pages/about/index.ts')).toContain("version: '1.2.0'");
    expect(read('components/tab-profile/index.wxml')).toContain('v1.2.0');
    expect(read('services/io.service.ts')).toContain("appVersion: '1.2.0'");
  });

  it('测试数据同步到 1.2.0', () => {
    for (const f of ['test-data/icar-test-fuel.json', 'test-data/icar-test-ev.json']) {
      expect(read(f)).toContain('"appVersion": "1.2.0"');
    }
  });
});
