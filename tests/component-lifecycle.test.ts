// 组件生命周期约束：observers 内不得在首次渲染前 setData
//
// 背景：微信渲染层报 "Expected updated data but get first rendering data"。
// 根因是自定义组件的 observers 在**首次接收属性**时就会触发（早于 ready），
// 此时首次渲染未完成，setData 与首帧数据竞争。三个图表组件曾因此报错。
//
// 正确写法：observers 里先判断是否已 ready，初始绘制交给 lifetimes.ready()。
const fsLife = require('fs') as any;

const COMPONENTS = [
  'components/donut-chart/index.ts',
  'components/line-chart/index.ts',
  'components/bar-chart/index.ts'
];

function read(f: string): string {
  return fsLife.readFileSync(f, 'utf-8');
}

/** 剥离注释，避免注释里提到的 setData / _ready 干扰位置判断 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('图表组件 observers 不得在首帧前 setData', () => {
  for (const f of COMPONENTS) {
    it(`${f} 的 observers 有 ready 守卫`, () => {
      const src = read(f);
      const obsStart = src.indexOf('observers:');
      expect(obsStart).toBeGreaterThan(-1);

      // 取 observers 块（到 lifetimes 之前），并剥离注释
      const lifeIdx = src.indexOf('lifetimes:', obsStart);
      expect(lifeIdx).toBeGreaterThan(obsStart);
      const obsBlock = stripComments(src.slice(obsStart, lifeIdx));

      // 必须存在 _ready 守卫
      expect(obsBlock).toContain('_ready');
      // 守卫必须在 setData 之前出现（否则等于没防）
      const guardIdx = obsBlock.indexOf('_ready');
      const setDataIdx = obsBlock.indexOf('setData');
      if (setDataIdx >= 0) {
        expect(guardIdx).toBeLessThan(setDataIdx);
      }
    });

    it(`${f} 在 ready 中标记 _ready 并绘制`, () => {
      const src = read(f);
      const lifeIdx = src.indexOf('lifetimes:');
      expect(lifeIdx).toBeGreaterThan(-1);
      const lifeBlock = src.slice(lifeIdx, src.indexOf('methods:', lifeIdx));
      expect(lifeBlock).toContain('_ready = true');
      expect(lifeBlock).toContain('this.draw()');
    });
  }
});

describe('无 observers 的组件不受此约束', () => {
  it('icon-picker 不使用 observers（因此无首帧竞态）', () => {
    const src = read('components/icon-picker/index.ts');
    expect(src).not.toContain('observers:');
  });
});
