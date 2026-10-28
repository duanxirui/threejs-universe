# COSMOS ATLAS · 开发文档中心

> 文档规范生效：2026-10-21 · 当前项目：Three.js / Vite · 当前任务编号：T01～T31（T25 已完成，T26 DE441 四天体 UTC 星历、T27 双尺度、T28 姿态/月相、T29 Gaia DR3 样本及 T30 OpenNGC 深空图鉴/三条课程均完成代码与浏览器专项验收；T29 数据专项 17/17 通过、T30 V3 兼容回归 58/58 通过；真机与部署待验）；最新进展以[任务台账](development-plan.md)为准。

本目录用于**记录设计方案、管理开发任务、逐日留存实际工作，以及日后快速追溯原因和验收证据**。文档现可加入 Git；请勿把密钥、令牌、个人隐私或内部凭证写入仓库。

## 统一导航

| 要查找的内容 | 唯一维护位置 |
| --- | --- |
| 文档规则、目录和日期索引 | 本页 `README.md` |
| 项目目标、V3 既有技术、V4 科学数据架构及可扩展布局、V1/V2 历史方案与部署机制 | [开发方案](development-scheme.md) |
| T01～T31 的最新状态、优先级、依赖及待验收项 | [开发计划与任务台账](development-plan.md) |
| 下一阶段实施顺序与分阶段验收 | [V4 里程碑及 T31、T25～T30 计划](development-plan.md#v4-真实科普宇宙升级计划2026-10-26) |
| 3D 主舞台、左右研究面板与移动工作区布局 | [T31 统一布局设计](development-scheme.md#v4-layout-t31) |
| T25 科普数值、参考来源及自动数据一致性检查 | [T25 原实施](plans/2026-10-26.md#t25-implementation) · [10-27 规则变更](plans/2026-10-27.md#t25-no-review) · [最新数据检查](baselines/2026-10-27-T25-data-check.json) · [参考数值对照](baselines/2026-10-27-T25-reference-crosscheck.json) |
| T26 四天体 DE441 日期星历、UTC 控件与验收 | [T26 实施](plans/2026-10-27.md#t26-implementation) · [技术架构](development-scheme.md#t26-utc-日期驱动星历实现2026-10-27) · [9 项数据检查](baselines/2026-10-27-T26-ephemeris-audit.json) · [20 项浏览器检查](baselines/2026-10-27-T26-browser-audit.json) |
| T27 真实尺度/科普增强双模式、相机浮动原点与验收 | [T27 实施](plans/2026-10-27.md#t27-implementation) · [技术设计与限制](development-scheme.md#t27-scale-implementation) · [尺度 9/9](baselines/2026-10-27-T27-scale-audit.json) · [浏览器 21/21](baselines/2026-10-27-T27-browser-audit.json) |
| T28 UTC 自转姿态、太阳光照方向、月相与季节读数 | [T28 实施](plans/2026-10-28.md#t28-implementation) · [技术设计与限制](development-scheme.md#t28-observation-implementation) · [几何 10/10](baselines/2026-10-28-T28-observation-audit.json) · [浏览器 14/14](baselines/2026-10-28-T28-browser-audit.json) |
| T29 Gaia DR3 真实恒星筛选样本、分层与检索 | [T29 实施](plans/2026-10-28.md#t29-implementation) · [数据及架构](development-scheme.md#t29-gaia-implementation) · [Gaia DR3 静态清单](../public/data/science/gaia-dr3/v1/manifest.json) · [浏览器 14/14](baselines/2026-10-28-T29-browser-audit.json) · [数据 17/17](baselines/2026-10-28-T29-data-audit.json) |
| T30 OpenNGC 深空目录、NASA 距离参考、三条科普课程 | [T30 实施](plans/2026-10-28.md#t30-implementation) · [数据及架构](development-scheme.md#t30-deep-sky-implementation) · [静态目录](../public/data/science/deep-sky/v1/manifest.json) · [数据 12/12](baselines/2026-10-28-T30-data-audit.json) · [浏览器 21/21](baselines/2026-10-28-T30-browser-audit.json) · [V3 兼容 58/58](baselines/2026-10-28-T30-V3-regression.json) |
| T31 实际改造、控件样式与隔离浏览器结果 | [T31 实施日志](plans/2026-10-26.md#t31-layout-implementation) · [PC/手机布局验收](baselines/2026-10-26-T31-audit.json) · [滚动条/下拉整理](plans/2026-10-28.md#t31-control-polish) · [PC/手机视觉截图](baselines/2026-10-28-T31-control-polish-visual.json) |
| 某天实际完成的功能、修复、验证与 Git 记录 | [按日开发日志](#按日开发日志索引) |
| 视觉截图、测试数据和可复核证据 | [T15 验收资料](baselines/2026-10-21-T15-browser-audit.md) · [V3/T24 浏览器结果](baselines/2026-10-23-V3-browser-audit.json) · [T24 手机弹窗截图](baselines/2026-10-23-T24-atlas-mobile.png) |

## 统一维护规则

1. **先查任务编号。** 在 [任务台账](development-plan.md) 中定位 TXX。T01～T16 是既有任务；2026-10-23 的 V3 使用 T17～T23，均已实现相应代码，T23 为用户可选择开启的离线功能；同日弹窗统一沿用连续编号 T24。T25～T30 用于 V4 数据、日期星历、尺度、现象、恒星与深空功能，其中 **T25 已完成、T26 四天体星历、T27 双尺度、T28 姿态/月相、T29 Gaia DR3 小样本及 T30 深空图鉴/课程的代码和浏览器专项验收均已完成；T29 数据专项 17/17 已补验、T30 V3 兼容回归 58/58 已补验**；T31 可扩展布局已通过浏览器回归。已有任务继续原编号，新需求使用下一个连续编号。任务状态只在任务台账维护，历史日志中的“已完成/待验收”均代表**记录当日**的判断。

   **2026-10-27 数据使用规则：** 所有数据和数值不要求科学审核、逐项签核或科研认证。保留结构、单位、来源信息、数值换算及软件功能测试；近似、示意和实际星历数据仍应清楚区分。此前的科学签核门禁已取消，T26 可以按任务计划直接启动。
2. **方案有独立归属。** 产品目标、架构、场景、关键接口、设计原则、部署机制维护在 [开发方案](development-scheme.md)；重大设计决策应注明日期、原因和影响。历史方案保留在此文档的原始存档部分，不能把过时状态当作当前结论。
3. **每天一个日志。** 只使用 `plans/YYYY-MM-DD.md`；同一天继续追加。记录实际完成的功能或修复、涉及文件、验证命令及环境与真实结果、限制、任务编号、Git 状态。没有执行的验证写“未验证”，不要补造数据。
4. **完成状态分开写。** “功能代码完成”与“浏览器验收通过”“实体设备验收通过”分别标记。失败、不具备设备、性能证据不足时维持待验收，不把构建通过等同于交付完成。
5. **关联真实提交。** 提交信息包含任务编号（例如 `fix(T15): ...`），提交后将 SHA 回填当日日志；未提交写“未提交”。原有可核实的 `6c6f8ac` 等历史提交保持原事实；不能伪造或预填哈希。未经明确授权不擅自提交或推送。
6. **所有文档修改后校验。** 运行 `node scripts/check-docs.mjs`（或 `npm run docs:check`），验证本地链接、锚点、任务号、按日索引、日志中的真实 Git SHA、目录 Git 忽略状态。源代码变化另运行适当代码验证。
7. **保持职责唯一。** 不新建独立的 `CHANGELOG.md`、`docs/AGENTS.md`、重复的方案、部署或素材汇总。验收图片与原始测量留在 `baselines/`。根目录 [`AGENTS.md`](../AGENTS.md) 只是 Codex 自动规则入口。

### 每项开发日志的最小格式

```md
### YYYY-MM-DD · [新增/修复/优化/文档] TXX：简短标题

- **需求/原因：** 要解决什么问题
- **实际完成：** 具体功能和关键决策
- **影响文件：** 真实路径
- **验证：** 命令、环境、结果；未执行就标为未验证
- **限制/后续：** 尚未解决或需设备验收的事项
- **Git：** 未提交；或已提交的真实 SHA
```

## 按日开发日志索引

| 日期 | 实际内容 | 方案/背景 |
| --- | --- | --- |
| [2026-10-15](plans/2026-10-15.md) | 基础项目、T01～T07、初期布局及相关修复；含当日历史方案 | V1/V2 评估和技术基础 |
| [2026-10-20](plans/2026-10-20.md) | T08～T15、界面设计迭代、自由航行、时间轴、T15 视觉基线 | [T15 历史实施方案](plans/2026-10-20.md#t15) |
| [2026-10-21](plans/2026-10-21.md) | T14/T15 场景化控制、统一图标与下拉、搜索/设置/指南视觉重组、T16 文档治理 | [T15 历史自动验收](baselines/2026-10-21-T15-browser-audit.md) · [当日视觉截图](plans/2026-10-21.md) |
| [2026-10-22](plans/2026-10-22.md) | T15 搜索 Esc 焦点恢复与 77 项回归；T12 阴影逐帧更新、局部遮挡与灰斑弱化；T07 LOD 切换滞回 | [T15 最新验收说明](baselines/2026-10-21-T15-browser-audit.md) |
| [2026-10-23](plans/2026-10-23.md) | T03 资源回收；T17～T22 V3 实施；T23 离线缓存；T24 弹窗统一及 56 项浏览器复测 | [T03](plans/2026-10-23.md#t03) · [V3 功能](plans/2026-10-23.md#t17) · [T23 离线实施](plans/2026-10-23.md#t23-implementation) · [T24 复核](plans/2026-10-23.md#t24-acceptance) |
| [2026-10-26](plans/2026-10-26.md) | T03 15/15、T04 15/15；T06 用户确认真机验收；T25～T30 科学升级规划；T31 PC/手机布局 26/26 + 77/77 + 56/56；T25 22 天体/110 字段、108 项转录对照及 V3 58/58；科学签核待补 | [T03](plans/2026-10-26.md#t03) · [T04](plans/2026-10-26.md#t04) · [T06](plans/2026-10-26.md#t06-device-update) · [V4 规划](plans/2026-10-26.md#v4-science-plan) · [T31 实施](plans/2026-10-26.md#t31-layout-implementation) · [T25 审校](plans/2026-10-26.md#t25-implementation) · [来源对照](plans/2026-10-26.md#t25-source-crosscheck) |
| [2026-10-27](plans/2026-10-27.md) | T25 取消科学审核门禁；T26 DE441 四天体日期星历；T31/T26 交互去重；T27 真实尺度双模式、浮动原点与相机控制；T27 9/9 + 21/21、T31 33/33、T15 77/77、V3 58/58 | [T25 调整](plans/2026-10-27.md#t25-no-review) · [T26 实施](plans/2026-10-27.md#t26-implementation) · [交互精简](plans/2026-10-27.md#t31-interaction-cleanup) · [T27 实施](plans/2026-10-27.md#t27-implementation) · [T27 浏览器专项](baselines/2026-10-27-T27-browser-audit.json) |
| [2026-10-28](plans/2026-10-28.md) | T28 姿态/月相、T29 Gaia DR3、T30 OpenNGC 图鉴/课程；后续针对 T31 工作区统一滚动条、科学筛选下拉与悬停/焦点反馈，生产构建及 PC/手机视觉截图完成；本次样式调整未新增自动回归计数；随后补跑 T29 Gaia 数据专项 17/17 及 T30 V3 兼容回归 58/58，均通过 | [T28 实施](plans/2026-10-28.md#t28-implementation) · [T29 实施](plans/2026-10-28.md#t29-implementation) · [T30 实施](plans/2026-10-28.md#t30-implementation) · [T31 样式整理](plans/2026-10-28.md#t31-control-polish) · [截图证据](baselines/2026-10-28-T31-control-polish-visual.json) · [T29 数据补验](plans/2026-10-28.md#t29-data-audit) · [T30 V3 补验](plans/2026-10-28.md#t30-v3-regression) |

## 历史迁移说明

2026-10-21 起使用本规范。旧 `DEVELOPMENT_PLAN.md` 的原始 V1/V2 方案、旧任务对照和实施讨论已纳入 [开发方案的历史部分](development-scheme.md#legacy-development-plan)，其旧“当前状态”只适用于记录日期；旧 `CHANGELOG.md` 的 41 条实际变更已按日期完整归入三个日志文件，原独立日志停用；旧 `DEPLOYMENT.md` 纳入 [开发方案的部署章节](development-scheme.md#deployment-guide)。2026-10-15 和 2026-10-20 旧的长篇按日方案在原日期文件中保留，固定的 T01～T15 锚点继续有效。

实际开发状态以 [任务台账](development-plan.md) 为准。Git 忽略解除后文档与截图将出现在 `git status`，只有执行 `git add` 和真正提交后才进入 Git 历史。
