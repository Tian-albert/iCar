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

describe('评测遗留两处：类型徽标与 0 里程引导', () => {
  it('各车明细显示能量类型（「哪些车是混动」要能在页面上看到）', () => {
    const wxml = read('pages/summary/index.wxml');
    expect(wxml).toContain('car-type');
    expect(wxml).toContain('typeText');

    const ts = read('pages/summary/index.ts');
    expect(ts).toContain("'混动'");
    expect(ts).toContain("'纯电'");
  });

  it('0 里程的车在详情页给补录入口，而不是整页 0', () => {
    const wxml = read('pages/vehicle-detail/index.wxml');
    expect(wxml).toContain('mileages === 0');
    expect(wxml).toContain('mileage-hint');
    expect(wxml).toContain('bindtap="onEditCar"');
  });
});

describe('写操作落点分流（mcp 一个接口只能声明一个 landing 页，靠参数分流）', () => {
  it('records 页处理 ask=1 / go=maintain-manage / new=1', () => {
    const ts = read('pages/records/index.ts');
    // 追问轮：转「我的车辆」，不能停在记录页
    expect(ts).toContain("options.ask === '1'");
    expect(ts).toContain("'/pages/index/index'");
    // 保养项缺失：转保养项管理
    expect(ts).toContain("'maintain-manage'");
    // 刚记完：滚到最新一条
    expect(ts).toContain('_scrollNew');
    expect(ts).toContain('pageScrollTo');
    // 接力带的 id 是编码过的，必须解码，否则查不到车、列表空态
    expect(ts).toContain('decodeURIComponent(options.id)');
  });
});

describe('我的车辆：能量类型要能在列表里看到', () => {
  it('car 列表项带 energyText，模板渲染它', () => {
    const ts = read('pages/index/index.ts');
    expect(ts).toContain('energyText');
    expect(ts).toContain("'混动'");

    const wxml = read('pages/index/index.wxml');
    expect(wxml).toContain('item.energyText');
  });
});
