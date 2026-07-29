# TaskVista WBS Phase 2 关门验证报告

| 项目 | 内容 |
|---|---|
| 验证日期 | 2026-07-29 |
| 验证对象 | `docs/WBS-Phase2-实施计划.md` |
| 验证范围 | P2a 甘特图、P2b WBS 构成、自动化测试、构建、IaC 与文档同步 |
| 结论 | **代码与文档阻塞已修复；仅剩浏览器回归，Phase 2 暂保持未关闭状态** |
| Phase 3 条件 | 完成下述浏览器关门回归后，才能开始 Phase 3 |

---

## 1. 结论摘要

Phase 2 的大部分基础能力已经存在：

- 导航已有 `ガント` 与 `構成`。
- 甘特图已有 WBS 树序、展开／折叠、父级汇总条、整条平移和未设定任务拖入日期。
- 构成图已有详细地图、构成地图、层级拖拽、结构保存和 WBS 重编号。
- 后端已有 move、reorder、renumber、create child API 及主要 WBS 校验。
- 前端、后端和基础设施 TypeScript 构建通过。
- 前端 24 项、后端 109 项自动化测试通过。

2026-07-29 经产品确认，以下三项不再构成阻塞：

- 甘特条只允许整体平移，不提供左右缘 resize，避免误触导致预计工时大幅变化。
- 有 `plannedDueDate` 时按计划日期跨度显示；无结束日时才按预计工时推算长度。
- 不要求为未接入 UI 的历史 resize helper 补充 Phase 2 验收测试。

本轮已完成：

- 修复默认 dev 环境的 `cdk synth`；dev 与 prod 均通过。
- 同步 README、WBS 主方案、系统说明、功能介绍与 Phase 2 基线。

当前只剩一项外部验证条件：当前会话没有可用浏览器，深树 DnD、视觉和真实指针交互尚未重新验收。

因此本次不能把 Phase 2 标记为已关门。

---

## 2. 验证方法

### 2.1 静态对照

逐项对照：

- `docs/WBS-Phase2-实施计划.md`
- `frontend/src/components/task/TaskTimeline.vue`
- `frontend/src/utils/taskSchedule.ts`
- `frontend/src/views/TaskTimelineView.vue`
- `frontend/src/views/TaskWbsView.vue`
- `frontend/src/components/task/WbsCompactMap.vue`
- `frontend/src/components/task/WbsCompactNode.vue`
- `backend/src/tasks/service.ts`
- `backend/src/tasks/wbs.ts`
- 前后端相关测试

### 2.2 自动化命令

执行：

```powershell
npm.cmd --prefix frontend run type-check
npm.cmd --prefix frontend run test
npm.cmd --prefix frontend run build

npm.cmd --prefix backend run type-check
npm.cmd --prefix backend run test
npm.cmd --prefix backend run build

npm.cmd --prefix infra run build
npm.cmd --prefix infra run synth
npm.cmd --prefix infra run cdk -- synth -c env=prod
```

说明：当前 PowerShell 禁止执行 `npm.ps1`，因此使用同一 Node 安装中的 `npm.cmd`，没有修改系统执行策略。

### 2.3 本地页面

- Vite 本地服务启动成功。
- `http://127.0.0.1:5173/` 返回 HTTP 200。
- HTML 包含 `#app` 根节点。
- 当前会话没有可用的交互式浏览器实例，因此没有执行点击、拖拽、截图和视觉回归。

---

## 3. 自动化结果

| 验证 | 结果 | 明细 |
|---|---|---|
| Frontend type-check | 通过 | `vue-tsc --build` |
| Frontend tests | 通过 | 5 files / 24 tests |
| Frontend production build | 通过 | Vite build |
| Backend type-check | 通过 | `tsc --noEmit` |
| Backend tests | 通过 | 12 files / 109 tests |
| Backend build | 通过 | `tsc` |
| Infra TypeScript build | 通过 | `tsc` |
| CDK synth（默认 dev） | 通过 | unresolved account 时省略 bucket 物理名，由 CloudFormation 生成 |
| CDK synth（prod） | 通过 | CloudFormation 模板生成成功；有 feature flag warning |
| Local frontend HTTP | 通过 | HTTP 200 |
| Browser manual regression | **未执行** | 当前会话无可用浏览器 |

---

## 4. P2a 甘特图验收

| Phase 2 验收项 | 结果 | 证据／说明 |
|---|---|---|
| 导航显示 `ガント` | 通过（静态） | `AppNav.vue` 已显示 `ガント`，路由保留 `/timeline` |
| WBS 树 + 时间轴 | 通过（静态） | `treeRows` 生成 WBS 行，右侧按日期网格绘制 |
| 父行展开／折叠 | 通过（静态） | `expandedIds`、expand button 已实现 |
| 父条只读汇总 | 通过（静态 + 后端测试） | 父行无拖动写回；后端拒绝父任务手改日程／工数 |
| 叶子整条平移 | 通过（静态） | pointer move 调用 `shiftScheduleByDays` |
| 叶子左右缘调整 | **明确不提供** | 产品安全决策：避免误触；工时和结束日通过详情编辑 |
| 点击打开详情 | 通过（静态） | 行和条保留 open task 流程 |
| 未设定任务拖到日期 | 通过（静态） | `set-start-date` 流程存在 |
| 无 WBS 扁平项目 | 通过（代码逻辑） | 无 parent 的任务作为根行 |
| 父任务 API 拒绝手改日程／工数 | 通过（自动化） | backend service test 已覆盖 |

### 4.1 产品决策：不提供左右缘 resize

`taskSchedule.ts` 已定义：

```text
resizeScheduleFromLeft()
resizeScheduleFromRight()
```

这些函数没有调用方。`TaskTimeline.vue` 当前注释和实现明确为：

```text
リーフ予定バーはドラッグで予定開始日のみ変更（工数リサイズなし）
```

现有 pointer state 只有整条拖动模式，没有 left/right edge 模式或 resize handle。产品已确认这正是目标行为；历史 helper 不属于当前 UI 或 Phase 2 验收范围。

### 4.2 产品决策：正式条宽语义

2026-07-29 修订后的 Phase 2 基线规定：

```text
起点 = plannedStartDate
有 plannedDueDate：使用开始日至结束日的日历跨度
无 plannedDueDate：使用 estimatedEffortDays 推算条长
```

当前 `resolveTaskSchedule()` 在同时存在开始日和结束日时：

- 使用 `plannedStartDate` 到 `plannedDueDate` 的完整日历跨度作为条宽。
- `estimatedEffortDays` 主要作为标签。

该行为已经被确认为正式产品语义。预计工时和计划结束日通过任务表单显式编辑；整条平移只写回开始日，不隐式改动另外两个字段。

### 4.3 自动化范围修订

现有自动化检查全部通过。由于左右缘编辑未进入产品范围，不再以 resize helper 的单元测试作为 Phase 2 阻塞项；整条平移等真实指针交互继续通过浏览器关门回归确认。

---

## 5. P2b WBS 构成验收

| Phase 2 验收项 | 结果 | 证据／说明 |
|---|---|---|
| 第 4 导航 `構成` | 通过（静态） | 路由和 AppNav 已实现 |
| 详细地图／构成地图 | 通过（静态） | `TaskWbsView` 的 map / outline 两模式 |
| 层级／同级拖拽 | 通过（静态） | vuedraggable 递归树与 dirty snapshot |
| 结构保存 | 通过（静态） | move 后逐父级 reorder |
| 深度 ≤ 3 | 通过（自动化 + 静态） | 前端 helper 与后端 validation |
| 循环保护 | 通过（自动化 + 静态） | WBS cycle helper 与后端 validation |
| 重编号 | 通过（自动化 + 静态） | renumber API 与 UI |
| 创建子／同级 | 通过（静态） | TaskForm 预填 parent |
| 刷新后顺序保持 | 代码路径具备，手工未验 | `sortOrder` 写回存在；未做真实刷新回归 |
| 深树 DnD／字下げ后 renumber | **未执行** | 原计划本身未勾选；当前无浏览器 |
| 甘特／表／看板 store 一致性 | 代码路径具备，手工未验 | 共用 tasks store；未做跨页面真实回归 |

P2b 的实现证据较完整，后端 WBS 测试也通过。剩余主要是浏览器级关门回归，而不是静态代码缺失。

---

## 5.1 Dashboard WBS 对应（2026-07-29 补充）

浏览器关门前发现 Dashboard 仍使用扁平任务口径。本轮已修正：

- 项目概要先执行 WBS enrichment，再以叶子任务统计状态和执行总数。
- 项目进度使用预计工时加权；无预计工时时使用叶子完成率简单平均。
- 新增 WBS 节点数、父节点数、叶子数、计划期间、预计／实际工时、超期、7 日内与评审等待指标。
- 担当任务和评审等待任务默认排除父级汇总节点。
- Dashboard 任务响应增加项目名称与祖先 WBS 路径，旧 Task 字段保持兼容。
- 画面按项目分组，显示 WBS 编号、祖先路径、进度、状态、优先级和计划区间。
- 项目卡增加看板、甘特、构成快捷入口。

新增后端自动化覆盖：

- 父子节点不重复计数。
- 叶子工时加权进度、工时和计划期间。
- 担当列表排除父节点并返回 WBS 路径。
- 评审等待列表排除父节点。

该功能已通过类型检查与专项测试，仍需纳入最终浏览器视觉和交互回归。

---

## 6. IaC 修复结果

原默认 dev synth 错误：

```text
Invalid S3 bucket name:
taskvista-dev-attachments-ntid.2]}
```

原因为：

1. `StorageStack` 和 `FrontendStack` 把 `cdk.Stack.of(this).account` 传入 `bucketNames()`。
2. 未提供具体 AWS account 时，该值是 CDK unresolved token。
3. `bucketNames()` 对 token 字符串直接执行 `slice(-8)`。
4. token 尾部字符被拼入 bucket 名，产生 `]`、`}` 等非法字符。

修复后 `bucketNames()` 只在账户值为具体 12 位数字时使用账户后缀；unresolved token 时不指定物理 bucket 名，由 CloudFormation 生成全局唯一名称。prod 继续使用 legacy 固定名称。

复验结果：

- `npm.cmd --prefix infra run build`：通过
- `npm.cmd --prefix infra run synth`（dev）：通过
- `npm.cmd --prefix infra run cdk -- synth -c env=prod`：通过

该阻塞项已关闭。两次 synth 仅保留既有 CDK feature-flag warning。

---

## 7. 文档同步状态

已同步：

- README：Phase 2 改为「已实现，关门回归中」，并加入 Phase 2 报告与 Phase 3 方案索引。
- WBS 主方案：升级为 v2.0，Phase 2 标记为已实现、关门回归中。
- 系统说明：正式加入 `ガント`、`構成`、条宽规则与无边缘 resize 的产品决策。
- 功能介绍：三画面更新为四画面，下一阶段改为任务依赖关系。
- Phase 2 实施计划：v0.2 正式记录产品决策，明确未来不得把左右缘 resize 作为缺陷。

P2a 的浏览器验收 checkbox 仍保持未勾选，待真实交互回归后填写。文档同步阻塞项已关闭。

---

## 8. 关门阻塞项

### 唯一 Blocker：完成浏览器关门回归

需要在可用浏览器环境完成：

- 甘特父行折叠和父条不可拖。
- 叶子整体平移，且左右缘不会触发工时或结束日修改。
- 未设定任务拖到日期。
- 构成图跨层拖拽、深度 3 限制和循环保护。
- 保存后刷新／重进，结构与顺序保持。
- 字下げ／字上げ后重编号。
- 结构变化后甘特、表格、看板一致。
- Dashboard 项目统计与构成图叶子统计一致，不重复计算父任务。
- Dashboard 担当／评审列表按项目分组，WBS 路径、进度和计划期间正确。
- Dashboard 项目卡的看板／甘特／构成快捷入口正确。
- 1920、普通笔记本宽度及窄屏基本布局检查。

本次已启动 Vite，`http://127.0.0.1:5173/` 返回 HTTP 200；但浏览器控制连接返回空列表 `[]`，因此不能用本会话完成上述真实交互。

---

## 9. 推荐处理顺序

```text
1. 为当前会话连接可用浏览器
2. 执行 Phase 2 手工关门清单并补录结果
3. 勾选 P2a／P2b 手工验收项，正式关闭 Phase 2
4. 开始 Phase 3 任务依赖开发
```

---

## 10. 当前关门决定

```text
Phase 2：NOT CLOSED
Phase 3：HOLD
```

Phase 3 的任务依赖方案已经保存，但在 Phase 2 上述阻塞项关闭前不进入编码阶段。
