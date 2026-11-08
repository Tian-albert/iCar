// Canvas 图表配色（T-05）：Canvas 2D 上下文不解析 CSS 变量，
// 因此把 app.wxss 的令牌在此镜像一份，供 fillStyle / strokeStyle 使用。
// 改动任一处颜色时必须同步另一处；tests/chart-theme.test.ts 会校验一致性。
export const CHART_THEME = {
  /** --color-primary */
  primary: '#3B6FF6',
  /** --color-primary-dark */
  primaryDark: '#1D4ED8',
  /** --color-card */
  card: '#FFFFFF',
  /** --color-text-1 */
  text1: '#1F2430',
  /** --color-text-3 */
  text3: '#9AA4B2',
  /** 外标签专用色（--color-text-2 的图表变体） */
  label: '#4A5363',
  /** --chart-grid */
  grid: '#EEF0F3',
  /** --color-border */
  border: '#E6EAF1',
  /** 气泡阴影，允许保持 rgba 字面量 */
  shadow: 'rgba(15,23,42,0.10)'
} as const;
