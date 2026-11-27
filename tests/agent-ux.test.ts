// 接力落点的三个体验约定
//
// 评测轨迹里的三句吐槽对应这三条：①「调出来一个空白的记录页」②「没滑到加油那里」
// ③「待处理里还是一堆正常项」。用文件级断言锁住，防止以后改页面时又丢。
const fsx2 = require('fs') as any;

const read = (p: string): string => fsx2.readFileSync(p, 'utf-8');

describe('接力落点：记录页接参数', () => {
  it('records 页面解析 carName / category / start / end', () => {
    const ts = read('pages/records/index.ts');
    expect(ts).toContain('options.carName');
    expect(ts).toContain('options.category');
    expect(ts).toContain('options.start');
    expect(ts).toContain('filterText');
  });

  it('有筛选时给出可清除的提示条', () => {
    const wxml = read('pages/records/index.wxml');
    expect(wxml).toContain('filterText');
    expect(wxml).toContain('onClearFilter');
  });
});

describe('接力落点：总览页按分类定位', () => {
  it('解析 focus=category&cat=xx 并滚动到分类卡', () => {
    const ts = read('pages/summary/index.ts');
    expect(ts).toContain('focusCat');
    expect(ts).toContain('pageScrollTo');
    expect(ts).toContain("'#catCard'");
    const wxml = read('pages/summary/index.wxml');
    expect(wxml).toContain('id="catCard"');
  });
});

describe('全车保养页：待处理不显示正常项', () => {
  it('pending 筛选下只渲染非 ok 项（不再靠置灰）', () => {
    const wxml = read('pages/maintain-all/index.wxml');
    expect(wxml).toMatch(/filter === 'all' \|\| mnt\.level !== 'ok'/);
    expect(wxml).not.toContain('item-dim');
  });
});
