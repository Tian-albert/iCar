// 需要以**属性值**形式传给组件的设计令牌
//
// 为什么单独建这个文件：`<switch color="...">`、`<slider activeColor="...">`
// 这类是 WXML 属性而非 CSS，读不到 CSS 变量，只能写死色值。
// 集中到这里，避免散落在各个 WXML 里，也便于与 app.wxss 保持一致
// （tests/chart-colors.test.ts 有断言校验）。

/** --color-primary */
export const COLOR_PRIMARY = '#3B6FF6';

/** --color-dark-card（沉浸式深色页导航栏） */
export const COLOR_DARK_CARD = '#1E2536';

/** --color-bg（页面背景） */
export const COLOR_BG = '#F5F6F8';

/** --color-card（卡片 / 白色） */
export const COLOR_CARD = '#FFFFFF';

/** --color-text-3（tabBar 未选中） */
export const COLOR_TEXT_3 = '#6B7486';

/** 表单组件（switch / slider）的统一强调色 */
export const COMPONENT_ACTIVE_COLOR = COLOR_PRIMARY;
