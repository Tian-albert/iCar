// 环形图与图例的双向联动
//
// 概览页是页面内直接画 canvas，选中状态本来就在页面 data 里；
// 统计页的环图在 donut-chart 组件内，如果没有「受控属性 + 事件」，
// 就会出现「点扇区只放大扇区、图例毫无反应」「点图例没任何效果」的割裂。
// 这个文件把这条链路钉住。
const fsDonut = require('fs') as any;

function read(p: string): string {
  return fsDonut.readFileSync(p, 'utf-8');
}

describe('donut-chart 组件：受控选中 + 事件回传', () => {
  const ts = read('components/donut-chart/index.ts');

  it('把 activeIndex 从内部 data 提升为受控属性', () => {
    expect(ts).toContain('activeIndex: { type: Number, value: -1 }');
    // data 里不能再有同名副本，否则属性与内部状态会各存一份
    expect(ts).not.toMatch(/data:\s*\{[^}]*activeIndex/);
  });

  it('属性变化时重绘，点击扇区时用 change 事件回传', () => {
    expect(ts).toContain('activeIndex() {');
    expect(ts).toContain("triggerEvent('change'");
    expect(ts).toContain('index: next');
  });

  it('点击后不在 onTap 里重复绘制（交给 observer）', () => {
    const onTapBlock = ts.slice(ts.indexOf('onTap('), ts.indexOf('draw() {'));
    // 允许 setData / triggerEvent，但不应再显式调用 this.draw()
    expect(onTapBlock).not.toContain('this.draw()');
  });
});

describe('统计页：扇区 ↔ 图例 双向联动', () => {
  const wxml = read('pages/statistics/index.wxml');
  const wxss = read('pages/statistics/index.wxss');
  const ts = read('pages/statistics/index.ts');

  it('选中状态传给组件，并监听 change', () => {
    expect(wxml).toContain('activeIndex="{{catActive}}"');
    expect(wxml).toContain('bindchange="onCatChange"');
  });

  it('图例行可点击、且按选中态加 cat-on', () => {
    expect(wxml).toContain("catActive === index ? 'cat-on'");
    expect(wxml).toContain('bindtap="onTapCatRow"');
    expect(wxss).toContain('.cat-row.cat-on');
  });

  it('选中态样式与概览页图例同语义（浅色填充）', () => {
    const block = wxss.slice(wxss.indexOf('.cat-row.cat-on'));
    expect(block).toContain('var(--color-fill)');
  });

  it('两个处理函数齐全：扇区回传 / 图例再点取消', () => {
    expect(ts).toContain('onCatChange');
    expect(ts).toContain('onTapCatRow');
    // 再次点击同一条应取消选中
    expect(ts).toContain('this.data.catActive === index ? -1 : index');
  });

  it('数据重载后清空选中，避免索引越界', () => {
    expect(ts).toContain('catActive: -1');
  });

  it('点图例时做越界保护', () => {
    const block = ts.slice(ts.indexOf('onTapCatRow'), ts.indexOf('catActive: this.data.catActive'));
    expect(block).toContain('index >= this.data.categories.length');
  });
});
