# iCar 车辆管理小程序

> 当前版本：**v1.0.2**

记录加油、保养、维修与支出，自动派生油耗、保养剩余量与用车成本统计。

微信小程序**原生开发**（TypeScript），数据**纯本地存储**（微信 Storage），云开发同步为后续规划。

## 功能

### 车辆
- 多车管理：添加车辆（名称、里程、购车日期、能源类型、图标）
- **车辆置顶**：列表点 📍 置顶，保养 Tab 优先展示置顶车辆
- 车辆图标：预设 emoji 可选，也支持上传自定义图片

### 记一笔（四类记录）
| 类型 | 内容 | 自动联动 |
|---|---|---|
| 加油 | 日期、里程、单价 × 油量 = 应付、实付、加满/低油量 | 生成加油类支出、重算油耗区间、回写车辆里程 |
| 保养 | 多选保养项、里程、日期、选填金额 | 生成 `MaintainHandle + N×MaintainLog`、保养类支出 |
| 维修 | 维修内容、里程、日期、选填金额 | 生成维修类支出 |
| 支出 | 类别、金额、日期、备注 | 生成支出流水 |

所有记录均支持**编辑**与**删除**（删除联动清理关联支出、重算区间与里程）。

### 油耗
- 按「加满锚点」规则自动生成油耗区间，计算 `L/100km` 与 `元/km`
- 车辆详情展示：最近油耗、平均油耗、**有效里程**（附释义说明）
- 记录列表每条加油卡片可展开区间统计条

### 保养
- 内置 6 个默认保养项模板（机油机滤 / 空调滤芯 / 空气滤芯 / 刹车油 / 火花塞 / 变速箱油）
- 保养周期可自定义：**按里程**（km）+ **按时间**（月 1–18 / 年 1–10 两个联动滚轮）
- 保养项支持添加、编辑、图标更换
- 剩余量 = 周期 − 已用（里程 / 天数），进度条展示剩余比例
- **提醒阈值每车独立设置**（剩余里程 ≤ N km 或剩余天数 ≤ N 天）
- 车辆详情只展示"快要保养"的项目，「更多」查看全量

### 统计看板
- 维度切换：月 / 年 / 全部
- 里程指标：最新总里程、增加总里程、加油里程
- 油耗指标：总油费、平均油耗（L/100km）、平均油耗（元/km）
- 支出指标：总支出、每公里支出、除掉油费（元/km）
- 图表：分类支出环形图、油耗趋势折线图、月度行程/费用柱状图（Canvas 2D 自绘）

### 其他
- **记录流水**：加油 / 保养 / 维修 / 支出四 Tab 统一列表
- **支出类别**：4 个预设（加油/保养/维修/停车）+ 自定义类别；可设置是否在"记支出"中显示；图标可换
- **数据备份**：导出全部数据为 JSON（复制或存文件）；导入支持**粘贴文本**或**选择 .json 文件**，按 `sourceId` 合并
- **自定义底部 TabBar**：毛玻璃风格（保养 / 车辆 / 我的）

## 快速开始

```bash
npm install          # 安装开发依赖
npm test             # 运行单测（9 个套件、44 个用例，用真实样本数据断言）
npm run typecheck    # 小程序代码类型校验
```

用**微信开发者工具**打开项目根目录：

1. 导入项目 → 选择本目录（`project.config.json` 已配置 TypeScript 编译插件）
2. AppID 使用自己的小程序 AppID（`project.config.json` 中 `appid` 字段）或选择测试号
3. 首次编译建议「清缓存 → 清除全部缓存」后重新编译

## 目录结构

```
├── app.ts / app.json / app.wxss     # 入口、页面注册、TabBar、全局设计令牌
├── project.config.json              # 开发者工具配置（TS 编译、过滤开关关闭）
├── sitemap.json
├── custom-tab-bar/                  # 自定义毛玻璃 TabBar
├── components/
│   ├── donut-chart/                 # 分类支出环形图（Canvas 2D）
│   ├── line-chart/                  # 油耗趋势折线图
│   ├── bar-chart/                   # 行程 / 费用柱状图
│   └── icon-picker/                 # 图标选择器（预设 emoji + 自定义上传）
├── pages/                           # 16 个页面，见下表
├── domain/                          # 领域层（纯函数，可脱离小程序用 Jest 验证）
│   ├── fuel.service.ts              # 金额联动、油耗区间判定与重算
│   ├── stats.service.ts             # 统计聚合 buildStats
│   └── maintain.service.ts          # 保养剩余量与紧急判定
├── services/                        # 应用服务（编排存储 + 领域逻辑）
│   ├── car.service.ts               # 车辆 CRUD、里程回写、车辆图标
│   ├── refuel.service.ts            # 加油保存/编辑/删除、区间重建
│   ├── maintain-record.service.ts   # 保养项模板、保养执行、周期、阈值
│   ├── repair.service.ts            # 维修记录
│   ├── cost.service.ts              # 支出与类别管理
│   ├── user.service.ts              # 偏好、会员、置顶车辆
│   └── io.service.ts                # .icar 数据导出 / 导入合并
├── repositories/                    # 存储适配层
│   ├── storage.adapter.ts           # 记录级读写 + 索引 + rebuildIndex 对账
│   ├── wx-storage.ts                # wx Storage 绑定
│   ├── migration.ts                 # schema 迁移（v1 → v1.4）
│   └── seed.ts                      # 预设类别种子
├── store/index.ts                   # 存储单例与初始化
├── types/models.ts                  # 10 张实体表类型定义
├── utils/                           # 金额、日期、ID、图标工具
├── typings/                         # 全局类型声明
├── tests/                           # Jest 单测与样本数据 fixture
└── docs/                            # 设计报告与审查结论
```

### 页面一览

| 页面 | 路径 | 说明 |
|---|---|---|
| 保养 | `pages/reminder` | Tab①：置顶车辆的即将保养项 |
| 车辆 | `pages/index` | Tab②：车辆列表、置顶、添加 |
| 我的 | `pages/user` | Tab③：提醒开关、类别管理、数据备份入口 |
| 车辆详情 | `pages/vehicle-detail` | 油耗卡、近期支出、保养进度、记录入口 |
| 车辆记录 | `pages/records` | 四类流水 Tab，含编辑/删除 |
| 统计 | `pages/statistics` | 月/年/全部 + 三图 |
| 添加车辆 | `pages/vehicle-form` | 含图标选择 |
| 记一笔（统一入口） | `pages/entry` | 加油 / 保养 / 维修 / 支出四分段，切换不清空已填内容 |
| 记加油 / 记保养 / 记维修 / 记支出 | `pages/refuel-form` 等 | 独立页，供记录列表编辑跳转 |
| 保养项管理 | `pages/maintain-manage` | 全量保养项 + 剩余进度 |
| 保养项编辑 | `pages/maintain-item-form` | 周期（里程 + 月/年滚轮）、图标 |
| 保养阈值 | `pages/maintain-threshold` | 每车提醒阈值 |
| 类别管理 | `pages/category-manage` | 显示开关、图标、增删改 |
| 数据导入导出 | `pages/data-transfer` | 导出 JSON / 粘贴导入 / 选文件导入 |
| 关于 | `pages/about` | 主体资质（备案编号）+ 工信部备案查询入口 |

## 数据存储

全部数据存于**微信本地 Storage**，按「一条记录一个 key」存储（避开单 key 1MB 限制）：

```
icar:index                         各表 ID 索引
icar:cars:<sourceId>               车辆
icar:categories:<sourceId>         支出类别
icar:maintains / maintainHandles / maintainLogs
icar:costs / repairRecords / fuelRecords / fuelConsumptions
icar:user                          偏好、会员、置顶车辆、提醒阈值
icar:meta                          schema 版本
```

自定义图标图片存于 `wx.env.USER_DATA_PATH`（不占 Storage 配额）。

> 当前**无云端同步**：换设备 / 卸载 / 清缓存会丢数据，请用「我的 → 数据导入导出」做备份。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 报错 `xxx.js 已被代码依赖分析忽略，无法被其他模块引用` | 开发者工具「过滤无依赖文件」误判动态路由页面。已在 `project.config.json` 关闭 `filterNoDependentFiles`；若仍出现，在「详情 → 本地设置」手动取消勾选并清缓存重编译 |
| 底部 TabBar 不显示 | 清缓存后重新编译（`app.json` 的 `tabBar.custom` 需重新构建） |
| 首次进入没有保养项 | 首次进入车辆详情/保养 Tab 会自动 seed 6 个默认保养项 |

## 品牌资源

| 资源 | 文件 | 规格 | 用途 |
| --- | --- | --- | --- |
| 小程序头像 | [`图片/miniprogram-avatar-144.png`](图片/miniprogram-avatar-144.png) | PNG · 144 × 144 px · 23.5 KB | 微信公众平台「小程序头像」上传 |

- 平台要求：格式支持 `png` / `bmp` / `jpeg` / `jpg` / `gif`，体积不可大于 **2 MB**，建议尺寸 **144 × 144 px**，推荐 PNG 以保持最佳效果。
- 本文件为 **PNG、144 × 144 px、23.5 KB**，完全满足上述要求。
- 风格：扁平极简——纯蓝底 + 白色汽车侧面剪影，去掉了立体阴影与装饰元素，小尺寸下依然清晰可辨。
- 设计含义：对应「车记本」——用最少的视觉元素表达"车 + 记录"。

## 文档

- [软件设计报告（SDR V1.3）](docs/软件设计报告.md) —— 需求、架构、数据模型、算法口径、接口、测试与发布计划，第 15 章为实现状态追踪
- [设计报告审查结论](docs/设计报告审查结论.md) —— 可行性审查问题清单与改进建议
- [V2 任务清单](docs/V2-任务清单.md) —— 未实现项的拆解（改动文件 / 实现要点 / 验收标准 / 排期）
- [上线检查清单](docs/上线检查清单.md) —— 首次提审前的资质、隐私声明、真机自测、提审材料与发布核对表
- [数据导出样本](iCar-export-20261021-170555.icar/manifest.json) —— `.icar` 格式与真实数据示例

## 许可

[Apache License 2.0](LICENSE)
