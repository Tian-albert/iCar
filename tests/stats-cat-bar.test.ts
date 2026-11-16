// 统计页「分类支出」的占比条：宽度即该分类占总支出的百分比。
//
// 纯 CSS 宽度百分比实现（非 canvas），所以结构契约可以直接断言。
const fsx = require('fs') as any;

const WXML = 'pages/statistics/index.wxml';
const WXSS = 'pages/statistics/index.wxss';

describe('分类支出占比条', () => {
  const wxml: string = fsx.readFileSync(WXML, 'utf-8');
  const wxss: string = fsx.readFileSync(WXSS, 'utf-8');

  it('每行有轨道 + 填充两层结构', () => {
    expect(wxml).toContain('cat-bar-track');
    expect(wxml).toContain('cat-bar');
  });

  it('填充宽度绑定 percent，颜色绑定该分类的 color', () => {
    // 宽度就是百分比，不需要额外换算
    expect(wxml).toMatch(/class="cat-bar"[^>]*width:\s*\{\{item\.percent\}\}%/);
    expect(wxml).toMatch(/class="cat-bar"[^>]*background:\s*\{\{item\.color\}\}/);
  });

  it('轨道宽度固定，各行的条起点才对齐、长度才可比', () => {
    const track = wxss.match(/\.cat-bar-track \{[\s\S]*?\}/);
    expect(track).toBeTruthy();
    // 用 flex:1 占据中间剩余空间
    expect(track![0]).toContain('flex: 1');
    expect(track![0]).toContain('overflow: hidden');
  });

  it('分类名定宽，不随名称长短左右移动比例条起点', () => {
    const name = wxss.match(/\.cat-name \{[\s\S]*?\}/);
    expect(name).toBeTruthy();
    // 不能用 flex:1 —— 否则名称越长条越短，长度失去可比性
    expect(name![0]).not.toContain('flex: 1');
    expect(name![0]).toMatch(/width:\s*\d+rpx/);
    expect(name![0]).toContain('text-overflow: ellipsis');
  });

  it('金额定宽右对齐，避免数字位数不同导致条长度抖动', () => {
    const amount = wxss.match(/\.cat-amount \{[\s\S]*?\}/);
    expect(amount).toBeTruthy();
    expect(amount![0]).not.toContain('flex: 1');
    expect(amount![0]).toMatch(/width:\s*\d+rpx/);
    expect(amount![0]).toContain('text-align: right');
  });

  it('占比极小时仍保留最小可见宽度', () => {
    const bar = wxss.match(/\.cat-bar \{[\s\S]*?\}/);
    expect(bar).toBeTruthy();
    // 1% 的项若没有 min-width，看起来就像没有数据
    expect(bar![0]).toMatch(/min-width:\s*\d+rpx/);
  });

  it('填充高度撑满轨道', () => {
    const bar = wxss.match(/\.cat-bar \{[\s\S]*?\}/);
    expect(bar![0]).toContain('height: 100%');
  });

  it('不使用 canvas 绘制（纯 CSS，避免与环图抢节点）', () => {
    // 取「占比条」到「cat-list 结束」这一段，其中不应出现 canvas
    const start = wxml.indexOf('cat-bar-track');
    const end = wxml.indexOf('</block>', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(wxml.slice(start, end)).not.toContain('canvas');
  });
});

describe('percent 的取值范围（宽度百分比的正确性前提）', () => {
  it('stats.service 产出的 percent 是 0~100，而不是 0~1', () => {
    const src: string = fsx.readFileSync('domain/stats.service.ts', 'utf-8');
    // 宽度直接绑 percent%，若这里是 0~1 小数，条会全部缩成 1%
    expect(src).toMatch(/\(amount \/ totalCost\) \* 100/);
  });

  it('percent 合计被修正为 100', () => {
    const src: string = fsx.readFileSync('domain/stats.service.ts', 'utf-8');
    expect(src).toContain('100 - named.reduce');
  });
});
