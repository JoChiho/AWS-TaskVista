# TaskVista：基于 WBS 视角的任务管理修正方案

| 项目 | 内容 |
|------|------|
| 版本 | **1.0**（Phase 1 已实现 · 已关门） |
| 日期 | 2026-07-23 |
| 对象 | 项目内的任务（Work Package）管理 |
| 前提 | 不破坏现行 DynamoDB / API / 画面，分阶段引入 |
| 状态 | **Phase 1 已交付 · 下一步 Phase 2（WBS 专用视图）** |
| 相对 0.2 | 字段/汇总/最小 UI 已落地；见 §15 实现纪要 |
| 确认日 | 2026-07-22（§12.1）· 关门日 2026-07-23 |

---

## 0. 版本变更摘要（0.1 → 0.2）

任务基础字段已从「单一开始日 / 截止日」改为 **予定与実績分离**（已在产品中落地，WBS 方案必须建立在此之上）：

| 旧（0.1 文档） | 新（现行实现） | UI 用语（日语） |
|----------------|----------------|-----------------|
| `startDate` | `plannedStartDate` | 予定開始日 |
| `dueDate`（业务含义） | `plannedDueDate` | 予定終了日 |
| — | `actualStartDate` | 実績開始日 |
| — | `actualDueDate` | 実績終了日 |
| `estimatedEffortDays` | 同左（保留） | 予定工数（人日） |
| — | `actualEffortDays` | 実績工数（人日） |

补充说明：

- 用语统一为 **終了日**（不再使用「締切日」作为业务字段名）。  
- `dueDate` 仍可能作为 **AssigneeIndex GSI 的镜像键**（= `plannedDueDate`），业务侧一律读 `plannedDueDate`。  
- 旧 `startDate` 仅读兼容，写入走 `plannedStartDate`。  
- 时间线条：`plannedStartDate` + `estimatedEffortDays`。  
- 任务详情：作成 / 更新在右上角；日程区为 **予定一行 3 项 / 実績一行 3 项** 上下对应；実績与予定对比时浅绿 / 浅红着色（開始・終了・工数；「実績」标签色跟終了日）。

---

## 1. 背景与目的

### 1.1 现状问题（对 PM 意见的理解）

现行 TaskVista 的任务是 **项目下的扁平作业卡片**。

- 没有父子关系与分解结构（无法表达 WBS 的「交付物 → 工作包 → 作业」）  
- 画面主轴是 **状态看板**（未着手 / 进行中 / レビュー待ち / 完了 / 保留）  
- 虽已有 **予定 / 実績** 的工数与日程、以及进度，但无法从结构上看出 **「整体分解了多少、彼此依赖什么」**  
- 大需求容易压成一张任务或并列同名任务，**范围边界模糊**

PM 提出的「希望以 **WBS（Work Breakdown Structure）** 的观点来设计 task 管理」，可理解为：

> 把项目分解为交付物与作业单位，并在这些单位上管理责任、予定/実績工数、进度与依赖。  
> 状态管理是 WBS 的 **运营层**，而不是结构本身。

### 1.2 本方案目标

1. 将 **WBS 树**（项目内的层级结构）作为一等概念引入  
2. **不破坏** 现行扁平 Task（含已上线的予定/実績字段），分阶段扩展为「带层级的 Task」  
3. 看板 / 表格 / 时间线 / レビュー / 任务详情 与 WBS 协调共存  
4. 不加重小团队（数人～十几人）的运营负担（不以完整 PMBOK 为目标）

### 1.3 非目标（本版不做）

- 正式 EVM（CV / SV / CPI）或完整 baselining  
- 成本科目、会计联动  
- 跨项目的公共 WBS 模板共享平台  
- 初版就实现自动排程（关键路径优化引擎）  

---

## 2. 现行数据结构整理（开发基线 · 2026-07）

### 2.1 实体关系（现状）

```
Project (1) ──owns──> Task (N) ──has──> Comment / Attachment
                │
                ├── assignees[] / assigneeId
                ├── reviewers[]
                ├── status / priority / completionPercent
                ├── estimatedEffortDays / actualEffortDays
                ├── plannedStartDate / plannedDueDate
                ├── actualStartDate / actualDueDate
                └── requirement / description
```

| 实体 | 主键 | 作用 |
|------|------|------|
| Project | `projectId` | 团队作业单位与成员边界 |
| Task | `projectId` + `taskId` | 作业卡片（扁平 · 无父子） |
| Comment | 挂在 task 下 | 讨论 |
| Attachment | task 元数据 + S3 | 资料 |

### 2.2 Task 属性（现行 · 与 WBS 的对应）

| 现行字段 | 含义 | 在 WBS 中的位置 |
|----------|------|-----------------|
| `title` | 名称 | WBS 要素名 |
| `requirement` | 要件 / 验收意图 | 范围描述 |
| `description` | 补充说明 | 作业说明 |
| `status` | 工作流状态 | **运营状态**（不是结构） |
| `completionPercent` | 0–100% | 进度（叶子录入，父级汇总） |
| `estimatedEffortDays` | 予定工数（人日） | 叶子录入；父级 **合计** |
| `actualEffortDays` | 実績工数（人日） | 叶子录入；父级 **合计** |
| `plannedStartDate` | 予定開始日 | 叶子录入；父级 **min** |
| `plannedDueDate` | 予定終了日 | 叶子录入；父级 **max**；仪表盘排序参考 |
| `actualStartDate` | 実績開始日 | 叶子录入；父级 **min**（可选展示） |
| `actualDueDate` | 実績終了日 | 叶子录入；父级 **max**（可选展示） |
| `assignees` | 担当 | 责任（建议仅叶子） |
| `reviewers` | レビュアー | 质量门禁（建议仅叶子） |
| `priority` | 优先级 | 执行优先（与 WBS 编号无关） |
| `createdAt` / `updatedAt` | 系统时间 | 详情右上角展示（不进日程网格） |
| `parentTaskId` | 父任务 ID | **已实现（Phase 1）** · 自引用；空=根 |
| `wbsCode` | WBS 编号 | **已实现（Phase 1）** · 自动生成，可改 |
| `sortOrder` | 同级排序 | **已实现（Phase 1）** · 字段具备；同级拖拽持久化属 Phase 2 |
| `nodeType` | 节点类型 | **字段已实现** · `milestone` 产品行为属 Phase 3 |
| `rollup` | 子汇总缓存/读时结果 | **已实现（Phase 1 · 读时计算）** |
| — | **依赖关系** | **未实现（Phase 3）** |

### 2.3 任务详情 UI（现行约定 · WBS 须兼容）

```
右上角: 作成 · 更新

日程块（3 列 × 2 行）:
  予定 | 開始日 | 終了日 | 工数（人日）
  実績 | 開始日 | 終了日 | 工数（人日）
```

実績着色（相对予定）：

| 条件 | 背景 |
|------|------|
| 実績開始 ≤ 予定開始 / 実績終了 ≤ 予定終了 / 実績工数 ≤ 予定工数 | 浅绿 |
| 実績更晚或工数超过 | 浅红 |
| 任一侧未设定 | 中性 |
| 「実績」行标签色 | **与実績終了日** 一致（绿/红/中性） |

### 2.4 时间线 / 看板（现行）

| 功能 | 规则 |
|------|------|
| 时间线条 | `plannedStartDate` + `estimatedEffortDays`（无予定開始则无条） |
| 拖拽设日 | 写入 `plannedStartDate` |
| 予定終了旗标 | `plannedDueDate`（不参与条长度） |
| 看板 / 进度滑块 | 与层级无关（WBS 后改为 **默认仅叶子**） |

### 2.5 存储约束

Tasks 表（DynamoDB）：

| 类型 | 键 | 用途 |
|------|-----|------|
| PK / SK | `projectId` / `taskId` | 项目内列表（**基表 Query 取全属性**） |
| GSI TaskIdIndex | `taskId` | 单条获取后再 GetItem |
| GSI AssigneeIndex | `assigneeId` + `dueDate` | 担当任务；`dueDate` 镜像 `plannedDueDate` |
| GSI ProjectStatusIndex | `projectId` + `status` | 参考（列表不依赖） |

- 小规模项目：全量任务拉取后在应用侧建树即可  
- 父子用 Task 自引用字段，**不必新建表**

---

## 3. WBS 设计方针（面向 TaskVista 的简化版）

### 3.1 采用的 WBS 思路

不做严格 PMBOK 式 WBS，而采用 **现场可用的 2～3 层交付物分解**。

```
Project（项目）
 └─ Level 1: 交付物 / 阶段（Deliverable or Phase）
      └─ Level 2: 工作包（Work Package）← 予定/実績・担当・状态的主单位
           └─ Level 3: 子任务（可选·明细作业）
```

| 层级 | 名称（UI 方案） | 表示什么 | 工数 / 日程 / 状态 |
|------|-----------------|----------|-------------------|
| L0 | 项目 | 现有 Project | 仅汇总 |
| L1 | 大项 / 交付物 | 交付成果、大块工作 | 由子项汇总（不手输） |
| L2 | 工作包 | 担当实际执行的单位 | **主要在此管理** |
| L3 | 子任务 | 再分解的细节（可选） | 可为叶子时录入 |

**原则（100% 规则的简化版）**

- 父级范围应由子级合计覆盖（避免遗漏与重复）  
- **予定/実績工数、予定/実績日期、进度、状态的「录入」仅限叶子**  
- 父级由 **子级自动汇总**（UI 只读）

### 3.2 「任务」一词的再定义

| 术语 | 含义 | 与现行 UI 的关系 |
|------|------|------------------|
| WBS 要素 / 节点 | 层级上的一个节点 | 仍是同一条 `Task` 记录 |
| 工作包 | 执行与看板的主单位 | ≈ 现行「タスク」卡片 |
| 父级（汇总） | 结构与汇总 | 看板上默认不显示 |
| 叶子 | 无子节点 | 可编辑予定/実績、进度、状态 |

实现：**一张表、一个实体（Task）增加层级字段**。

---

## 4. 数据模型修正案

### 4.1 Task 完整形态（现行 + WBS）

```ts
interface Task {
  // ---- 现行（已实现，WBS 开发不得破坏）----
  taskId: string
  projectId: string
  title: string
  description?: string
  requirement?: string
  status: TaskStatus
  priority: TaskPriority
  assignees?: TaskAssignee[]
  reviewers?: TaskReviewer[]
  completionPercent?: number
  estimatedEffortDays?: number
  actualEffortDays?: number
  plannedStartDate?: string   // 予定開始日
  plannedDueDate?: string     // 予定終了日
  actualStartDate?: string    // 実績開始日
  actualDueDate?: string      // 実績終了日
  dueDate?: string            // GSI 镜像（= plannedDueDate）
  // startDate?: string       // 仅旧数据读兼容
  attachments: AttachmentMeta[]
  createdBy: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean

  // ---- WBS 新增（本方案正式开发范围）----
  /** 父任务 ID。未设置 = 项目下的根节点 */
  parentTaskId?: string | null

  /** WBS 编码（如 "1", "1.2", "1.2.3"），可手改 */
  wbsCode?: string

  /** 同一父级下排序（从 0 起） */
  sortOrder?: number

  /**
   * 节点类型
   * - summary: 汇总（通常有子节点）
   * - work_package: 执行单位（默认）
   * - milestone: 里程碑（工数 0 · 日期点）
   */
  nodeType?: 'summary' | 'work_package' | 'milestone'

  /** 前置任务 ID（Phase 3） */
  predecessorIds?: string[]

  /** 汇总缓存（可选） */
  rollup?: {
    childCount: number
    estimatedEffortDaysSum?: number
    actualEffortDaysSum?: number
    completionPercentAvg?: number
    earliestPlannedStart?: string
    latestPlannedDue?: string
    earliestActualStart?: string
    latestActualDue?: string
  }
}
```

### 4.2 字段设计要点

| 项目 | 方针 |
|------|------|
| `parentTaskId` | 自引用。删除策略见 §12 |
| `wbsCode` | 人读编号；可提供子孙重编号 |
| `sortOrder` | 拖拽排序实体字段 |
| `nodeType` | 省略时 `work_package` |
| `predecessorIds` | Phase 3 |
| 深度上限 | **建议最多 3 层**（L1–L3） |

### 4.3 与现有数据的兼容

| 现有 Task | 迁移后 |
|-----------|--------|
| 全部 | `parentTaskId = null`（根） |
| 全部 | `nodeType = 'work_package'` |
| 全部 | `sortOrder` 可按 `createdAt` 编号 |
| 予定/実績字段 | **原样保留** |
| 仅有旧 `startDate`/`dueDate` 的数据 | 继续由 `presentTask` 映射到 planned* |

**无破坏性变更。** 不使用 WBS 时体验与现在一致。

### 4.4 汇总规则（父节点 · 对齐予定/実績）

| 指标 | 汇总方法（推荐） |
|------|------------------|
| 予定工数 | 子 `estimatedEffortDays` **合计**（空=0） |
| 実績工数 | 子 `actualEffortDays` **合计**（空=0） |
| 进度 % | **予定工数加权**平均；无工数时等权 |
| 予定開始 | 子 `plannedStartDate` **最小** |
| 予定終了 | 子 `plannedDueDate` **最大** |
| 実績開始 | 子 `actualStartDate` **最小**（有则） |
| 実績終了 | 子 `actualDueDate` **最大**（有则） |
| 状态 | 全完了→完了；任一对进行中/レビュー待ち/保留→进行中；全未着手→未着手 |

父级详情块：

- 展示 **汇总后的予定行 / 実績行**（只读）  
- 実績着色规则与叶子相同（相对 **父级自己的汇总予定**）  
- 作成 / 更新仍显示该节点自身系统时间  

> **推荐：** 只写叶子；父级展示在 **读取时 rollup**（可选写 `rollup` 缓存）。

### 4.5 对 DynamoDB 的影响

| 变更 | 是否需要 | 说明 |
|------|----------|------|
| 新表 | 不需要 | 扩展 Task 属性 |
| 新 GSI（初版） | 可选 | 小规模全量建树即可 |
| 现有 GSI | 保持 | 继续镜像 `plannedDueDate` → `dueDate` |
| 迁移 | 软迁移 | WBS 字段 optional |

---

## 5. API 修正案

### 5.1 现有 API 扩展（向后兼容）

| 方法 | 路径 | 变更 |
|------|------|------|
| POST | `/projects/{id}/tasks` | body + `parentTaskId`, `nodeType`, `sortOrder` |
| PUT | `/tasks/{id}` | 同上 + `wbsCode`；既存予定/実績字段不变 |
| GET | `/projects/{id}/tasks` | 层级字段；`view=flat\|tree` |
| GET | `/tasks/{id}` | 可选 `children[]` 摘要 + 可选 `rollup` |
| PATCH | `/tasks/{id}/status` | **仅叶子** |

### 5.2 建议新增 API

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/tasks/{id}/children` | 创建子任务 |
| POST | `/tasks/{id}/move` | `{ newParentId, sortOrder }` |
| POST | `/projects/{id}/tasks/reorder` | 同父批量排序 |
| POST | `/projects/{id}/wbs/renumber` | WBS 重编号 |

### 5.3 校验（重要）

1. `parentTaskId` 须在同一 `projectId`  
2. 禁止循环引用  
3. 深度 ≤ 配置上限（默认 3）  
4. 里程碑默认不可有子  
5. 父级不可手改予定/実績/进度（API 可拒绝）  
6. 删除策略见 §12  

---

## 6. UI / 画面修正方针

### 6.1 各视图职责

| 画面 | 职责 | 与 WBS |
|------|------|--------|
| **WBS / 树**（新建） | 结构、编号、排序 | 主结构编辑 |
| 表格 | 属性横断 | 缩进 / WBS 号；予定・実績列 |
| 看板 | 日次状态 | **默认仅叶子** |
| 时间线 | 日程 | 叶子：`plannedStartDate`+予定工数；父可选汇总条 |
| 仪表盘 | 担当 / レビュー | 叶子优先；排序用 `plannedDueDate` |
| 任务详情 | 单节点 | 面包屑 + 子列表 + **现行 3×2 日程块** |

### 6.2 WBS 视图（草案）

```
[项目名]  WBS     [＋根]  [重编号]

1  ■ 要件定义                         予5.0 / 実2.0  進捗40%
1.1  □ ヒアリング                     予2.0 / 実2.0  100%  担当:A
1.2  □ 要件书                         予3.0 / 実—     0%    担当:B
```

操作：缩进 / 反缩进、同级拖拽排序、加子/加同级、点开详情。

### 6.3 看板

| 设置 | 内容 |
|------|------|
| 默认 | 仅叶子（且非纯 summary） |
| 可选 | 「也显示父级」 |
| 卡片 | 可显示小 WBS 号；予定終了着色逻辑不变 |

### 6.4 时间线

- 叶子：`plannedStartDate` + `estimatedEffortDays`  
- 父：子 min(予定開始)～max(予定終了或工数推算结束) 浅条（Phase 2）  
- 拖拽写 `plannedStartDate`：**仅叶子**

### 6.5 用语

| 概念 | 日语 UI | 中文 |
|------|---------|------|
| WBS 视图 | WBS / 構成 | 结构 |
| L1 | 大項目 | 大项 |
| L2 | 作業 / タスク | 工作包 |
| L3 | サブタスク | 子任务 |
| 予定/実績 行 | 予定 · 実績 | 计划 · 实际 |
| 終了日 | 終了日 | 结束日（不用「締切」） |
| 工数 | 工数（人日） | 人日 |

---

## 7. 分阶段路线图（正式开发）

### Phase 0：确认与定稿 — **Done**

- 确认 §12  
- 冻结本版字段与汇总规则  

### Phase 1：数据 + 最小 UI（MVP）— **Done（2026-07-23 关门）**

**后端** ✅

- `parentTaskId`, `sortOrder`, `wbsCode`, `nodeType`  
- create / update / list / presentTask 扩展  
- 循环、深度、父级只读校验  
- 列表/详情 rollup（读时）  

**前端** ✅

- 表格：WBS 号 / 树展开 / 层内加子  
- 创建：级联父级选择  
- 详情：面包屑、子列表、父级日程只读汇总  
- 看板：默认仅叶子 + 范围模式  

**验收** ✅（见 §13 / §15）

- 无 WBS 的旧项目体验不变  
- 可建 2～3 层父子  
- 父级予定/実績工数与进度可从子级看到汇总  
- 叶子详情 3×2 日程与着色不变  

### Phase 2：WBS 专用视图 — **Next**

- 导航增加 WBS  
- 缩进 / 排序 / 重编号  
- 时间线父级条  

### Phase 3：依赖与里程碑

- `predecessorIds`  
- `nodeType=milestone`  
- 可选依赖冲突警告  

### Phase 4：模板与高级汇总（可选）

- WBS 模板、导出、按 WBS 的残工数看板  

---

## 8. 与现行功能的对照

| 现行功能 | 引入 WBS 后 |
|----------|-------------|
| 看板改 status | 仅叶子 |
| 进度滑块 | 仅叶子；父只读汇总 |
| 予定/実績日期与工数 | 仅叶子可写；父汇总 |
| 详情 3×2 日程 + 着色 | 叶子保持；父展示汇总值 + 同规则着色 |
| 作成/更新右上角 | 各节点自身时间 |
| 时间线拖拽 | 仅叶子 → `plannedStartDate` |
| レビュー | 仅叶子 |
| 评论 / 附件 | 任意节点可挂（运营建议叶子） |

---

## 9. 备选方案对比

| 方案 | 判定 |
|------|------|
| **A. Task 自引用** | **采用** |
| B. 独立 WbsNode | 初期不采用 |
| C. 标签伪层级 | 不采用 |
| D. 子项目化 | 不采用 |

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| 层级过深 | 上限 3；默认可扁平 |
| 父进看板混乱 | 默认仅叶子 |
| 父级手改与汇总冲突 | API+UI 禁止写父级日程/工数/进度 |
| 予定/実績汇总误解 | 详情保持 2 行 3 列；文档与 tooltip 说明「集計」 |
| 孤儿节点 | move/delete 单测 |
| GSI 丢字段 | 继续基表 Query + dueDate 镜像 |

---

## 11. 成功指标（草案）

| 指标 | 目标意象 |
|------|----------|
| 回归 | 不用 WBS 时 UX 不坏 |
| 结构使用率 | 上线 1 月后新项目 ≥50% 用 2 层+ |
| 予定/実績可解释 | 父级汇总可直接用于例会 |
| 范围粒度 | 「超大单任务」减少 |

---

## 12. 正式开发前需确认的决策点

请确认人勾选或回复，**确认后按 Phase 1 开工**。

### 12.1 必须确认（已定稿 · 2026-07-22）

| # | 议题 | 决定 |
|---|------|------|
| D1 | **层级深度** | **最多 3 层**（L1–L3） |
| D2 | **看板默认** | **仅叶子** |
| D3 | **父级进度** | **予定工数加权**平均（无工数时等权） |
| D4 | **删除父级** | **级联逻辑删除**子级 |
| D5 | **首发范围** | **仅 Phase 1**（字段 + 表缩进/父级选择 + 详情面包屑与汇总 + 看板仅叶子；**不做**完整 WBS 树屏） |
| D6 | **里程碑 / 依赖** | **不进 Phase 1**（Phase 3） |

### 12.2 建议确认（可不阻塞，但影响实现细节）

| # | 议题 | 推荐默认 |
|---|------|----------|
| D7 | 父级详情是否展示実績行汇总 | **展示**（与叶子同布局，只读） |
| D8 | 无予定工数时进度汇总 | **等权平均** |
| D9 | WBS 编码 | Phase 1 **自动生成**，可选手改 |
| D10 | 创建任务时父级选择器 | Phase 1 **要有**（下拉即可） |

### 12.3 已可作为基线、无需再议（除非推翻）

- 予定/実績字段模型与「終了日」用语  
- 时间线以 `plannedStartDate` + 予定工数  
- 详情 3×2 日程布局与実績着色规则  
- 不新建表、Task 自引用  
- 不使用 WBS 时扁平体验保持  

---

## 13. 正式开发准备清单（Phase 1）

### 13.1 工程任务拆分（建议 PR 顺序）— **全部完成**

1. ✅ **Backend 类型 + schema + repository**  
2. ✅ **Backend list/get rollup**（读时计算）  
3. ✅ **Frontend types + 表格缩进/WBS 列**  
4. ✅ **Frontend 创建/编辑：父级选择**  
5. ✅ **Frontend 详情：面包屑 + 子列表 + 父级只读汇总**  
6. ✅ **Frontend 看板：叶子过滤**（+ 范围模式）  
7. ✅ **单测 / 回归**：`wbs.test.ts` + service 父锁定/深度等  

### 13.2 测试要点 — **已覆盖（单元 + 手工）**

- 旧任务无 WBS 字段：列表/看板/时间线/详情  
- 建 1→1.1 父子后父级予定工数=子合计  
- 删除/移动不产生环与孤儿（按 D4）  
- 叶子仍可拖时间线写 `plannedStartDate`  
- 父级改工数/进度 API 拒绝；看板 PATCH status **仅叶子**  

### 13.3 文档同步 — **本关门 PR 完成**

- ✅ 更新 `docs/TaskVista-システム説明.html`（字段与 WBS）  
- ✅ 更新 `docs/TaskVista-機能紹介.html`（用户向）  
- ✅ 本方案版本号 **1.0**  

---

## 14. 总结

- **予定/実績** 与 **WBS 父子结构（Phase 1）** 均已落地。  
- 核心仍是 **`parentTaskId` + 排序 + 类型 + 按予定/実績的汇总规则**。  
- UI 上 **表管结构，看板/时间线跑叶子，详情保持 3×2 予定·実績对照**。  
- **Phase 1 已关门。下一步：Phase 2 WBS 专用视图（缩进/排序/重编号/时间线父条）。**  

---

## 15. Phase 1 实现纪要（1.0 · 2026-07-23）

### 已交付

- 字段：`parentTaskId` / `sortOrder` / `wbsCode` / `nodeType`（optional）  
- 校验：同项目父、环、深度 ≤ 3、改父含子孙高度  
- 父（有子）：进度・予定/実績・担当 **只读**（API 拒绝）；详情/表单只读展示  
- 父 status：子策略受限（`forced_progress` 等）；**看板 PATCH status 仅叶子**  
- rollup：读时计算（前后端）；予定/実績工数 **合计**（1 位小数）；进度 **工数加权** / 无工数 **等权**  
- 実績終了汇总：仅当子 **全部完了** 后取 `max(actualDueDate)`  
- 删除父：级联逻辑删除子孙（D4）  
- `wbsCode`：缺码自动补全；改父 renumber 子树  
- UI：表树 / WBS 列、创建级联父选择、详情面包屑 + 子列表 + 3×2 汇总、看板默认叶子 + 范围（最小単位 / 階層 / すべて）、卡片 WBS 号、列整高 drop 区  

### 刻意未做（Phase 2+）

- 独立 WBS 树导航屏  
- 依赖（`predecessorIds`）、里程碑产品行为  
- 专用 REST：`POST /children` / `/move` / `/wbs/renumber`  
- `GET ...?view=tree`  
- 同级 `sortOrder` 拖拽持久化  
- 时间线父级浅条  

### 与方案正文的接受微差

- 无 `view=flat|tree`：全量 flat + 前端建树（小规模足够）  
- 无独立 move/renumber API：能力在 update + 内部 renumber  
- 父 status 策略细于 §4.4 简单表  

### 相关代码入口

| 层 | 路径 |
|----|------|
| 后端纯逻辑 | `backend/src/tasks/wbs.ts` |
| 后端编排 | `backend/src/tasks/service.ts` |
| 前端工具 | `frontend/src/utils/wbs.ts` |
| 表 / 看板 / 详情 | `TaskTableView` / `TaskBoardView` / `TaskDetail` |

---

## 附录 A. 示例 WBS

```
Project: 客户门户改版
1  要件与调研                          [summary]  予5.0 / 実2.0
  1.1  現行業務ヒアリング              [WP] 予2.0 実2.0  担当:山田
  1.2  要件清单整理                    [WP] 予3.0 実—   担当:山田
2  设计
  2.1  画面跳转                        [WP] 予2.0
  2.2  API 规格                        [WP] 予3.0
3  实现
  3.1  登录                            [WP] 予5.0
  3.2  仪表盘                          [WP] 予8.0
4  验收
  4.1  验收测试                        [WP] 予3.0  レビュアー:PM
  4.2  生产发布                        [MS] 予定終了のみ
```

## 附录 B. 概念差分

```diff
 interface Task {
   // ... 现行 planned* / actual* / estimated* / actualEffortDays
+  parentTaskId?: string | null
+  wbsCode?: string
+  sortOrder?: number
+  nodeType?: 'summary' | 'work_package' | 'milestone'
+  predecessorIds?: string[]   // Phase 3
 }
```

## 附录 C. 相关文档

- `docs/TaskVista-システム説明.html`  
- `docs/TaskVista-機能紹介.html`  
- 现行实现：`frontend/src/types/task.ts`、`backend/src/shared/types.ts`  

---

*本文档 1.0：Phase 1 已实现并关门（2026-07-23）。下一阶段见 §7 Phase 2。*
