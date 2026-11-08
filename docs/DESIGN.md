# iCar 界面设计规范（WXSS 版）

> 建立于 2026-11-08，依据同日 UI 一致性审计。本文是**给人和 AI 编码 agent 共同阅读的设计说明书**：
> 新增或修改任何 WXML/WXSS 前先读本文；与 `docs/软件设计报告.md` 第 6 章冲突时，以本文为**落地口径**，设计报告 6.1 保留为需求原本。
>
> 本文只约束视觉表现，不涉及数据口径与业务逻辑；`npm test` 不覆盖样式，改动后须真机走查。

## 1. 适用范围与技术约束

| 项 | 约束 |
| --- | --- |
| 技术栈 | 微信小程序原生 WXML + WXSS，非 Web HTML/CSS |
| 单位 | 普通声明统一用 `rpx`（750rpx = 屏宽）；**但 `app.wxss` 的自定义属性只能用 `px` 或 hex 单值** —— WXSS 编译器对含 `rpx` / `rgba()` / 逗号的变量值兼容性不稳，曾导致全局样式异常。因此 `--radius-*` / `--space-*` 与新增令牌统一为 `px`（按 375px 屏与 rpx 等价换算） |
| 作用域 | `app.wxss` 全局作用于页面；**自定义组件默认样式隔离**，组件内需自行引令牌或传值 |
| Canvas | **Canvas 2D 上下文不解析 CSS 变量**，`fillStyle`/`strokeStyle` 只能写字面量 → 必须引用 `utils/chart-draw.ts` 导出的 `CHART_THEME`，不得写死色值 |
| 安全区 | 底部固定元素用 `env(safe-area-inset-bottom)`；页面底部留白 ≥ `160rpx + 安全区` |
| 深色模式 | 首版不支持，不要引入 `prefers-color-scheme` |
| 共享模块 | 新增 `utils/` 小模块前先确认开发者工具能编译产出 js（曾因 `chart-theme.ts` 未产出 js 导致全站白屏）。**优先并入已有且验证可加载的模块**；避免 `as const` / `satisfies` 等较新语法，内置 TS 插件版本可能落后。新增/删除模块后必须跑 import 可解析性检查（已固化为 `tests/chart-theme.test.ts`） |

## 2. 颜色令牌

全部定义在 `app.wxss` 的 `page {}` 内，通过 `var(--*)` 使用。

| 类别 | 令牌 | 值 | 用途 |
| --- | --- | --- | --- |
| 品牌 | `--color-primary` | `#3B6FF6` | 主按钮、链接、选中态、图表主线 |
| | `--color-primary-light` | `#EEF3FE` | 主色浅底、次级按钮底 |
| | `--color-primary-dark` | `#1D4ED8` | 按下态、图表选中柱 |
| 背景 | `--color-bg` | `#F5F6F8` | 页面底 |
| | `--color-card` | `#FFFFFF` | 卡片、气泡、输入框底 |
| | `--color-fill` | `#F2F3F5` | 分段控件轨道、灰色槽 |
| | `--color-dark-card` | `#1E2536` | 深色统计卡（专用） |
| 文字 | `--color-text-1` | `#1F2430` | 主标题、数值 |
| | `--color-text-2` | `#5A6272` | 正文、次要标签 |
| | `--color-text-3` | `#9AA4B2` | 辅助说明、轴标签、占位符 |
| | `--color-text-4` | `#8A93A6` | 深色卡上的次级文字（仅深色底使用） |
| 线条 | `--color-divider` | `#F0F1F4` | 卡片内分隔线（**统一此值**） |
| | `--color-border` | `#E6EAF1` | 气泡/浮层描边 |
| 语义 | `--color-danger` | `#F5474F` | 删除、必填星号、逾期 |
| | `--color-success` / `--color-success-bg` | `#2BA84A` / `#E8F7EE` | 正常、已完成 |
| | `--color-warning` / `--color-warning-bg` | `#E8912A` / `#FFF3E0` | 临近提醒 |
| 图表 | `--chart-1`～`--chart-6` | 蓝/绿/橙/红/紫/青 | 分类支出扇区，按序取用 |
| | `--chart-grid` / `--chart-axis` | `#EEF0F3` / `#9AA4B2` | 网格线与坐标轴（WXSS 侧） |

**阴影/遮罩的 `rgba()` 是合理例外**，允许字面量，但优先用第 4 节的 `--shadow-*` 令牌。

### 旧色值迁移映射（禁止再出现）

| 旧写法 | 改为 |
| --- | --- |
| `#fff` / `#FFF` / `#ffffff` | `var(--color-card)` |
| `#f5f6f8` | `var(--color-bg)` |
| `#3b6ff6` | `var(--color-primary)` |
| `#1f2430` / `#5a6272` / `#9aa4b2` | `var(--color-text-1/2/3)` |
| `#f0f1f4` / `#eceef2` | `var(--color-divider)` |
| `#f2f3f5` | `var(--color-fill)` |
| `#8a93a6` | `var(--color-text-4)` |
| `#e6eaf1` / `#e5e7eb` | `var(--color-border)` |
| `#eef0f3` | `var(--chart-grid)` |
| `#1d4ed8` / `#4a5363`（canvas） | `CHART_THEME.primaryDark` / `CHART_THEME.label` |

## 3. 字号、间距、圆角阶梯

新增代码**只从下列档位取值**，不要再引入第 20 种字号。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--font-xs` | `11px`（22rpx） | 角标、极小说明 |
| `--font-sm` | `12px`（24rpx） | 辅助文字、标签、轴标签 |
| `--font-md` | `14px`（28rpx） | 正文、表单值、按钮 |
| `--font-lg` | `16px`（32rpx） | 卡片标题、小节标题 |
| `--font-xl` | `20px`（40rpx） | 指标数值、页面主标题 |

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--sp-1` | `4px`（8rpx） | 图标与文字间隙 |
| `--sp-2` | `8px`（16rpx） | 元素间距、控件内边距 |
| `--sp-3` | `12px`（24rpx） | 页面外边距、**卡片内边距基准** |
| `--sp-4` | `16px`（32rpx） | 卡片内左右留白、分组间距 |
| `--sp-5` | `24px`（48rpx） | 区块间距 |

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--r-sm` | `4px`（8rpx） | 小标签、分段项 |
| `--r-md` | `8px`（16rpx） | 卡片、输入框 |
| `--r-lg` | `12px`（24rpx） | 浮层、底部弹层 |
| `--r-pill` | `999px` | 胶囊按钮、标签 |

> 括号中为 375px 屏下的等价 `rpx` 值。令牌定义**必须**写 `px`（见第 1 节）；普通声明仍可直接写 `rpx`。

**卡片内边距统一 `var(--sp-3) var(--sp-4)`**；历史 `8rpx 32rpx` / `28rpx 32rpx` / `40rpx 32rpx` 三种写法逐步收敛，改动时顺手对齐。

## 4. 深度与层级

> **阴影不定义为自定义属性**（复合值含 `rgba()` 与逗号，WXSS 编译器支持不稳，曾导致全局样式异常）。
> 在使用处直接写字面量，属第 2 节允许的 `rgba()` 合理例外：
>
> - 普通卡片：`box-shadow: 0 2rpx 12rpx rgba(15, 23, 42, 0.05);`
> - 悬浮主按钮：`box-shadow: 0 10rpx 28rpx rgba(59, 111, 246, 0.40);`

层级顺序：页面底 → 卡片（白 + `--shadow-card`）→ 浮层/气泡（白 + 描边 `--color-border` + 略重阴影）→ 悬浮按钮。列表页**必须有卡片阴影**，否则一屏白卡片会糊成一片。

## 5. 组件状态（当前最大缺口）

每个可交互元素都要覆盖下表，缺一项视为未完成：

| 状态 | 做法 |
| --- | --- |
| 默认 | 按第 2/3 节令牌 |
| 按下 | WXML 加 `hover-class`，样式里降透明度到 `0.6` 或换 `--color-primary-dark` |
| 禁用 | `.is-disabled { opacity: .5; }` + 事件内 `return`，不要只靠视觉 |
| 加载 | 耗时操作（导入/导出）用 `wx.showLoading({ mask: true })` + `hideLoading`，禁止界面静止 |
| 空态 | 图标/符号 + 一句说明 + 引导动作，不能只有一行灰字 |
| 失败 | `wx.showToast({ icon: 'none' })` 给明确原因，见 `utils/save-guard.ts` |

**点击区域 ≥ 44×44pt**（NFR-06）：小图标、文字链接、卡片右上角「…」都要补 `padding` 撑开，不能只给文字本身绑定事件。

## 6. Canvas 图表专用

`components/{donut,line,bar}-chart/index.ts` 通过 `utils/chart-draw.ts` 的 `CHART_THEME` 取色，禁止内联 hex。

```ts
// 正确
ctx.fillStyle = CHART_THEME.primary;
// 错误
ctx.fillStyle = '#3B6FF6';
```

新增图表颜色时**同时**在 `app.wxss` 加 `--chart-*` 与 `chart-draw.ts` 的 `CHART_THEME` 加同值常量，两处用注释关联；`tests/chart-theme.test.ts` 校验两者一致。

字号在 canvas 里用逻辑像素（`10px sans-serif` 等），与 WXSS 的 rpx 阶梯无关，不要互相套用。

## 7. 布局原则

- 页面左右外边距 `24rpx`；卡片之间 `20rpx`；区块标题与内容之间 `16rpx`。
- 表单用「卡片分组」：基本信息 / 金额信息 / 选项，每组一个 `.card`，组间距 `20rpx`。
- 指标一律三列等分，数值用 `--font-xl` + `font-weight: 600`，标签用 `--font-sm` + `--color-text-3`。
- 底部有悬浮按钮的页面，`padding-bottom` 留 `200rpx + env(safe-area-inset-bottom)`。
- 不要用 `backdrop-filter` 做关键可读性依赖（低版本 Android 支持不稳）。

## 8. Do's and Don'ts

**Do**

- 新增样式先查第 2/3 节有没有现成令牌
- 颜色一律 `var(--*)`，尺寸一律 `rpx`
- 复用页面里已有的 `.card` / `.btn-primary` 语义，不要造近义类
- 长按拖动、删除等破坏性操作给二次确认（回收站见 `services/recycle.service.ts`）

**Don't**

- 不要在 wxss 或 canvas TS 里写新的 hex
- 不要把 `px` 和 `rpx` 混用于同一语义（圆角、间距尤甚）
- 不要用暗色营销站风格：本项目是浅色工具型小程序，暗色仅用于 `--color-dark-card` 那张统计卡
- 不要照搬 Web 设计系统：Geist/SF Pro 等专有字体、112px 巨标题、全屏摄影、断点响应式都不适用
- 不要在自定义组件里假设能读到页面级 class（样式隔离）
- 不要只改颜色不改状态：点了没反馈比颜色不统一更伤体验

## 9. 审计基线（2026-11-08）

| 指标 | 审计时 | 目标 |
| --- | --- | --- |
| wxss 非令牌色值 | 76 处（页面 65 / tabbar 4 / icon-picker 7） | 0（阴影 rgba 除外） |
| canvas TS 内联色串 | 16 处 / 14 行 | 0（统一走 `CHART_THEME`） |
| 字号取值种类 | ≥19 种 rpx | 5 档 |
| 圆角取值种类 | ≥10 种 | 4 档 |
| `.card` 重复定义 | 18 页各一套 | 逐步收敛到统一值 |
| `hover-class` | 仅 2 处 | 所有可点击元素 |
| 无空态页面 | 13 页 | 0 |

**优先打磨顺序**（客观评分：硬编码色值 + 重复分隔线 + 结构复杂度 + 状态缺失）：
① `pages/entry`（28.5）② `pages/vehicle-detail`（25.9）③ `pages/records`（18.2）。

### 本轮收敛结果（2026-11-08）

| 指标 | 审计时 | 本轮后 |
| --- | --- | --- |
| wxss 非令牌色值 | 76 处 | **0**（仅 `app.wxss` 定义处保留 hex；阴影 `rgba()` 属合理例外） |
| canvas TS 内联色串 | 16 处 / 14 行 | **0**（集中到 `utils/chart-draw.ts` 的 `CHART_THEME`，20 处替换） |
| 令牌数量 | 29 | **48**（补 19 个：语义色 5、字号 5、间距 5、圆角 4；阴影与遮罩改为使用处字面量） |
| `hover-class` | 2 处 | **22 处**（entry / vehicle-detail / records 的分段、开关、卡片、悬浮项） |
| 卡片阴影 | records 0 | 三个优先页面统一 `--shadow-card` |
| 卡片内边距 | 4 种写法 | 三个优先页面统一 `var(--sp-3) var(--sp-4)` |

防漂移：`tests/chart-theme.test.ts` 校验 `CHART_THEME` 与 `app.wxss` 令牌同值、图表组件与全部页面 wxss 不再内联 hex。

**未在本轮处理**（避免扩散）：其余 15 个页面的 `.card` / `.btn-primary` 重复定义（目标为逐页收敛到统一值）、13 个页面缺失空态、字号从 19 种收敛到 5 档、`--radius-*` px 系列迁移到 rpx 系列。这些不影响已通过的真机走查，按页改动时顺手对齐即可。
