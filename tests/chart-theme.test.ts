// T-05 防漂移：canvas 主题色必须与 app.wxss 令牌一致，且业务代码不得内联 hex
// 项目 tsconfig.types 只含小程序类型，Node 模块声明不可用，故用 require + 根相对路径
import { CHART_THEME } from '../utils/chart-theme';

const fs = require('fs') as any;
const path = require('path') as any;

const css: string = fs.readFileSync('app.wxss', 'utf-8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`app.wxss 缺少令牌 --${name}`);
  return m[1].toUpperCase();
}

describe('chart-theme 与设计令牌一致性（T-05）', () => {
  it('每个主题色都对应同值的 CSS 令牌', () => {
    expect(CHART_THEME.primary).toBe(token('color-primary'));
    expect(CHART_THEME.primaryDark).toBe(token('color-primary-dark'));
    expect(CHART_THEME.card).toBe(token('color-card'));
    expect(CHART_THEME.text1).toBe(token('color-text-1'));
    expect(CHART_THEME.text3).toBe(token('color-text-3'));
    expect(CHART_THEME.grid).toBe(token('chart-grid'));
    expect(CHART_THEME.border).toBe(token('color-border'));
  });

  it('主题色集中定义且格式合法', () => {
    for (const [key, value] of Object.entries(CHART_THEME)) {
      if (key === 'shadow') continue;
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('图表组件与绘制工具不再内联 hex 色值', () => {
    const files = [
      'components/bar-chart/index.ts',
      'components/line-chart/index.ts',
      'components/donut-chart/index.ts',
      'utils/chart-draw.ts'
    ];
    for (const f of files) {
      const src: string = fs.readFileSync(f, 'utf-8');
      expect(src).not.toMatch(/['"]#[0-9A-Fa-f]{3,8}['"]/);
    }
  });

  it('页面与组件 WXSS（app.wxss 除外）不再内联 hex 色值', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full: string = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') out.push(...walk(full));
        } else if (entry.name.endsWith('.wxss') && entry.name !== 'app.wxss') {
          out.push(full);
        }
      }
      return out;
    };
    const files = [...walk('pages'), ...walk('components')];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src: string = fs.readFileSync(f, 'utf-8');
      // 阴影/遮罩的 rgba() 属合理例外，只禁止 hex
      expect(src).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    }
  });
});
