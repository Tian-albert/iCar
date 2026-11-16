/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  },
  /*
   * 覆盖率统计范围。
   *
   * 原来只统计 `domain/**`（3 个文件），`services` / `pages` / `utils` / `components`
   * 共 60 多个源文件完全不在统计里，80% 门槛形同虚设。
   * 现在把全部业务代码纳入，页面与组件由 page-smoke 的运行时冒烟兜住。
   */
  collectCoverageFrom: [
    'domain/**/*.ts',
    'repositories/**/*.ts',
    'services/**/*.ts',
    'utils/**/*.ts',
    'pages/**/*.ts',
    'components/**/*.ts',
    'custom-tab-bar/**/*.ts',
    'app.ts'
  ],
  /*
   * 阈值分两档：
   * - 全局按「扩大范围后的实际值往下留 3~4 个点」设定（实测 68/57/64/69），
   *   作用是防止覆盖率滑坡，而不是逼着补到 80（页面层靠冒烟而非行覆盖）
   * - `domain/` 保留原来的 80/80/60，那是最核心的纯逻辑，标准不降
   */
  coverageThreshold: {
    global: {
      branches: 54,
      functions: 60,
      lines: 66,
      statements: 65
    },
    './domain/': {
      branches: 60,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};
