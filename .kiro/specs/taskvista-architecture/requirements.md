# 需求文档

## 简介

TaskVista 是一个面向小型开发团队（5-15 人）的任务与项目进度追踪 Web 应用，旨在替代 Google Sheets 管理开发及评审任务。系统提供 Kanban 看板与 Table 列表双视图，支持 Project 与 Task 的完整生命周期管理，采用 AWS Serverless 架构，前端使用 Vue 3 + Vuetify 3，并在架构层面预留迁移至 Google Cloud 的能力。

---

## 词汇表

- **System**：TaskVista 系统整体，包含前端与后端所有组件
- **Frontend**：Vue 3 + Vuetify 3 单页应用，通过 VITE_API_BASE_URL 与后端解耦
- **API_Gateway**：Amazon API Gateway HTTP API，负责路由 RESTful 请求
- **Lambda**：AWS Lambda 函数（Node.js），实现业务逻辑
- **DynamoDB**：Amazon DynamoDB，存储 Projects、Tasks、Comments 数据
- **S3**：Amazon S3，存储静态前端资源与任务附件
- **CloudFront**：Amazon CloudFront CDN，分发前端静态资源
- **Cognito**：Amazon Cognito User Pools，负责用户认证与授权
- **CloudWatch**：Amazon CloudWatch，收集结构化日志与监控指标
- **Project**：项目实体，包含名称、描述、状态、创建者、成员列表等属性
- **Task**：任务实体，归属于某个 Project，包含标题、描述、状态、场所、要望、Assignee、优先级、截止日期等属性
- **Comment**：评论实体，归属于某个 Task，包含内容、作者、创建时间等属性
- **Attachment**：附件实体，归属于某个 Task，存储于 S3 的 `tasks/{taskId}/` 路径下
- **User**：经过 Cognito 认证的团队成员
- **Assignee**：被分配负责某个 Task 的 User
- **KanbanView**：Kanban 看板视图，按任务状态分列展示 Task 卡片，支持拖拽变更状态
- **TableView**：表格列表视图，以行列方式展示 Task，支持排序、筛选、分页
- **Dashboard**：总览页面，展示跨 Project 的任务统计与进度汇总
- **CorrelationId**：每次 Lambda 调用生成的唯一标识符，用于关联日志链路

---

## 需求

### 需求 1：用户认证与授权

**用户故事：** 作为团队成员，我希望通过安全登录访问 TaskVista，以确保只有授权用户才能查看和操作团队数据。

#### 验收标准

1. WHEN 用户访问 TaskVista 且未登录，THE Frontend SHALL 将用户重定向至 Cognito 登录页面。
2. WHEN 用户提交有效的用户名和密码，THE Cognito SHALL 返回 JWT Access Token 与 ID Token。
3. WHEN 用户提交无效的用户名或密码，THE Cognito SHALL 返回认证失败错误，THE Frontend SHALL 展示"用户名或密码错误"的提示信息。
4. WHEN 用户的 JWT Token 过期，THE Frontend SHALL 使用 Refresh Token 自动刷新，若刷新失败则重定向至登录页面。
5. WHEN 已认证用户请求 API，THE API_Gateway SHALL 验证 JWT Token 签名与有效期，拒绝无效请求并返回 HTTP 401 状态码。
6. WHEN 已认证用户点击退出登录，THE Frontend SHALL 清除本地 Token 并重定向至登录页面。
7. THE Cognito SHALL 支持至少 15 个并发用户会话。

---

### 需求 2：Project 管理（CRUD）

**用户故事：** 作为项目负责人，我希望创建、查看、编辑和删除项目，以便团队能够快速启动新项目，无需手动复制 Google Sheets。

#### 验收标准

1. WHEN 已认证用户提交包含有效名称（1-100 个字符）的创建项目请求，THE Lambda SHALL 在 DynamoDB Projects 表中创建项目记录，并返回 HTTP 201 状态码及新建项目的完整 JSON 数据（含 projectId、name、description、status、createdBy、createdAt、updatedAt）。
2. WHEN 已认证用户请求项目列表，THE Lambda SHALL 从 DynamoDB 查询该用户有权限访问的所有项目，并在 2000ms 内返回项目列表。
3. WHEN 已认证用户请求特定 projectId 的项目详情，THE Lambda SHALL 从 DynamoDB 查询并返回该项目的完整数据。
4. IF 请求的 projectId 在 DynamoDB 中不存在，THEN THE Lambda SHALL 返回 HTTP 404 状态码及描述性错误消息。
5. WHEN 已认证用户提交更新项目请求，THE Lambda SHALL 在 DynamoDB 中更新对应记录，更新 updatedAt 时间戳，并返回 HTTP 200 状态码及更新后的项目数据。
6. WHEN 已认证用户提交删除项目请求，THE Lambda SHALL 在 DynamoDB 中将该项目标记为已删除（软删除），并返回 HTTP 200 状态码。
7. IF 创建项目请求中名称字段为空或超过 100 个字符，THEN THE Lambda SHALL 返回 HTTP 400 状态码及字段级别的验证错误消息。
8. THE DynamoDB Projects 表 SHALL 使用 projectId 作为分区键，并维护 createdBy 的 GSI 以支持按用户查询。

---

### 需求 3：Task 管理（CRUD）

**用户故事：** 作为团队成员，我希望在项目内创建、查看、编辑和删除任务，以便追踪每个工作项的进度和责任人。

#### 验收标准

1. WHEN 已认证用户提交包含有效标题（1-200 个字符）和 projectId 的创建任务请求，THE Lambda SHALL 在 DynamoDB Tasks 表中创建任务记录，并返回 HTTP 201 状态码及新建任务的完整 JSON 数据（含 taskId、projectId、title、description、status、assigneeId、priority、location、requirement、dueDate、createdBy、createdAt、updatedAt）。
2. WHEN 已认证用户请求某 projectId 下的任务列表，THE Lambda SHALL 从 DynamoDB 查询该项目的所有任务，并在 2000ms 内返回。
3. WHEN 已认证用户请求特定 taskId 的任务详情，THE Lambda SHALL 返回该任务的完整数据，包含关联的 Comment 数量。
4. IF 请求的 taskId 在 DynamoDB 中不存在，THEN THE Lambda SHALL 返回 HTTP 404 状态码及描述性错误消息。
5. WHEN 已认证用户提交更新任务请求，THE Lambda SHALL 在 DynamoDB 中更新对应记录，更新 updatedAt 时间戳，并返回 HTTP 200 状态码及更新后的任务数据。
6. WHEN 已认证用户更新任务的 assigneeId 字段，THE Lambda SHALL 验证 assigneeId 对应的用户存在于 Cognito User Pool 中，若不存在则返回 HTTP 400 状态码。
7. WHEN 已认证用户提交删除任务请求，THE Lambda SHALL 在 DynamoDB 中将该任务标记为已删除（软删除），并返回 HTTP 200 状态码。
8. THE DynamoDB Tasks 表 SHALL 使用 taskId 作为分区键，projectId 作为 GSI 分区键，以支持按项目高效查询。
9. THE Lambda SHALL 支持任务状态值为以下之一：「未着手」「進行中」「レビュー待ち」「完了」「保留」。
10. IF 任务状态值不在允许列表内，THEN THE Lambda SHALL 返回 HTTP 400 状态码及枚举值列表的错误消息。

---

### 需求 4：Kanban 看板视图

**用户故事：** 作为团队成员，我希望通过 Kanban 看板直观地查看任务状态分布，并通过拖拽快速变更任务状态。

#### 验收标准

1. WHEN 用户进入某 Project 的看板页面，THE Frontend SHALL 按任务状态（「未着手」「進行中」「レビュー待ち」「完了」「保留」）将任务分列展示，每列使用 Vuetify v-card 渲染任务卡片。
2. WHEN 用户将任务卡片从一个状态列拖拽至另一个状态列，THE Frontend SHALL 使用 vuedraggable 处理拖拽交互，并立即调用 API 更新任务状态，在 API 响应前乐观更新 UI。
3. IF 状态更新 API 调用失败，THEN THE Frontend SHALL 将任务卡片回滚至拖拽前的状态列，并展示错误提示信息。
4. THE Frontend SHALL 在每个任务卡片上展示任务标题、Assignee 头像或姓名、优先级标识、截止日期（若存在）。
5. WHILE Kanban 数据正在加载，THE Frontend SHALL 展示骨架屏（skeleton loader）占位符。
6. THE Frontend SHALL 支持在 Kanban 视图中通过 Assignee 或优先级筛选任务卡片，筛选操作在客户端完成且无需重新请求 API。

---

### 需求 5：Table 列表视图

**用户故事：** 作为项目负责人，我希望通过表格视图查看项目内所有任务的详细字段，并支持排序、筛选和分页，以便进行数据分析和跟进。

#### 验收标准

1. WHEN 用户进入某 Project 的表格页面，THE Frontend SHALL 使用 Vuetify v-data-table 展示任务列表，默认显示列：场所（location）、要望（requirement）、状态（status）、Assignee、优先级、截止日期、创建时间。
2. THE Frontend SHALL 支持用户点击列标题对任务列表按该列进行升序或降序排序，排序在客户端完成。
3. THE Frontend SHALL 支持用户通过状态、Assignee、优先级组合筛选任务列表，筛选操作在客户端完成。
4. THE Frontend SHALL 支持分页展示，每页默认显示 20 条任务，用户可选择每页显示 10、20、50 条。
5. WHEN 用户在表格视图点击某行任务，THE Frontend SHALL 打开 Task 详情侧边栏或跳转至 Task 详情页面。
6. THE Frontend SHALL 支持用户在表格视图中通过搜索框按任务标题进行模糊搜索，搜索在客户端完成，结果在用户输入后 300ms 内更新。

---

### 需求 6：Task 详情与评论管理

**用户故事：** 作为团队成员，我希望查看任务的完整详情并添加评论，以便记录讨论过程和决策。

#### 验收标准

1. WHEN 用户打开 Task 详情页，THE Frontend SHALL 展示任务的所有字段（标题、描述、状态、场所、要望、Assignee、优先级、截止日期、创建者、创建时间、最后更新时间）及评论列表。
2. WHEN 已认证用户提交包含非空内容（1-2000 个字符）的评论，THE Lambda SHALL 在 DynamoDB Comments 表中创建评论记录，并返回 HTTP 201 状态码及新评论的完整 JSON 数据（含 commentId、taskId、content、authorId、createdAt）。
3. WHEN 用户请求某 taskId 的评论列表，THE Lambda SHALL 从 DynamoDB 查询该任务的所有评论，按 createdAt 升序排列返回。
4. IF 评论内容为空或超过 2000 个字符，THEN THE Lambda SHALL 返回 HTTP 400 状态码及字段级别的验证错误消息。
5. THE DynamoDB Comments 表 SHALL 使用 commentId 作为分区键，taskId 作为 GSI 分区键，以支持按任务查询评论。
6. WHEN 已认证用户为评论的 authorId，THE Frontend SHALL 展示该评论的删除按钮；WHEN 用户点击删除，THE Lambda SHALL 从 DynamoDB 中删除该评论记录（硬删除），并返回 HTTP 200 状态码。

---

### 需求 7：附件管理

**用户故事：** 作为团队成员，我希望为任务上传和下载附件，以便共享相关文档和截图。

#### 验收标准

1. WHEN 已认证用户请求上传附件，THE Lambda SHALL 生成 S3 预签名 PUT URL（有效期 15 分钟），路径格式为 `tasks/{taskId}/{attachmentId}-{filename}`，并返回该 URL 与附件元数据。
2. WHEN 前端收到预签名 PUT URL，THE Frontend SHALL 直接将文件上传至 S3，不经过 Lambda，以避免 Lambda 6MB payload 限制。
3. THE Lambda SHALL 限制单个附件大小不超过 50MB，IF 文件大小超过 50MB，THEN THE Lambda SHALL 返回 HTTP 400 状态码及大小限制说明。
4. WHEN 已认证用户请求下载附件，THE Lambda SHALL 生成 S3 预签名 GET URL（有效期 60 分钟）并返回，THE Frontend SHALL 使用该 URL 触发浏览器下载。
5. THE S3 附件桶 SHALL 配置生命周期规则，将超过 365 天未访问的附件转移至 S3 Glacier Instant Retrieval 存储类别。
6. WHEN 已认证用户删除附件，THE Lambda SHALL 从 DynamoDB 的 Task 附件元数据中移除记录，并调用 S3 DeleteObject 删除对应文件，返回 HTTP 200 状态码。

---

### 需求 8：Dashboard 与数据统计

**用户故事：** 作为项目负责人，我希望在 Dashboard 页面查看跨项目的任务统计与进度汇总，以便快速掌握团队整体工作状态。

#### 验收标准

1. WHEN 已认证用户访问 Dashboard，THE Frontend SHALL 展示该用户有权限访问的所有 Project 的摘要列表，包含项目名称、总任务数、各状态任务数量。
2. THE Frontend SHALL 展示"我负责的任务"列表，显示当前用户作为 Assignee 且状态不为「完了」的任务，按截止日期升序排列。
3. WHEN 已认证用户请求 Dashboard 统计数据，THE Lambda SHALL 从 DynamoDB 聚合数据，并在 3000ms 内返回统计结果。
4. THE Frontend SHALL 在 Dashboard 展示任务状态分布图表（使用 Vuetify 内置组件或轻量图表库），直观显示各状态任务占比。
5. WHILE Dashboard 数据正在加载，THE Frontend SHALL 展示加载指示器（progress indicator）。

---

### 需求 9：API 设计与可观测性

**用户故事：** 作为后端开发者，我希望所有 API 遵循 RESTful 规范并输出结构化日志，以便维护、排查问题，并支持未来迁移至 Google Cloud。

#### 验收标准

1. THE API_Gateway SHALL 为所有 API 端点启用 CORS，允许来自 CloudFront 域名的跨域请求。
2. THE Lambda SHALL 在每次调用时生成唯一的 CorrelationId，并将其包含在所有结构化 JSON 日志条目中。
3. THE Lambda SHALL 将结构化日志输出至 CloudWatch，日志格式包含字段：correlationId、requestId、level、message、timestamp、duration（ms）。
4. WHEN Lambda 执行时间超过 5000ms，THE Lambda SHALL 输出 level 为 WARN 的日志条目并包含 duration 字段。
5. IF Lambda 发生未捕获的异常，THEN THE Lambda SHALL 返回 HTTP 500 状态码及通用错误消息（不暴露堆栈信息），并将完整错误详情记录至 CloudWatch。
6. THE API_Gateway SHALL 遵循 RESTful 资源路径规范：`/projects`、`/projects/{projectId}`、`/projects/{projectId}/tasks`、`/tasks/{taskId}`、`/tasks/{taskId}/comments`、`/tasks/{taskId}/attachments`。
7. THE System SHALL 使用标准 HTTP 方法（GET、POST、PUT、PATCH、DELETE）与状态码（200、201、400、401、403、404、500），以确保 API 在迁移至 Google Cloud Run 时无需修改前端调用逻辑。

---

### 需求 10：前端部署与 CDN 分发

**用户故事：** 作为运维负责人，我希望前端应用通过 CloudFront + S3 进行部署和分发，以便实现低成本、高可用的全球访问。

#### 验收标准

1. THE Frontend SHALL 构建为静态资源，部署至 S3 静态托管桶，并通过 CloudFront Distribution 分发。
2. THE CloudFront SHALL 配置自定义错误响应，将 HTTP 403 和 404 错误重定向至 `index.html`，以支持 Vue Router 的 History 模式。
3. THE Frontend SHALL 通过 `VITE_API_BASE_URL` 环境变量配置 API Gateway 端点，构建时注入，不硬编码 AWS 资源 ARN 或 URL。
4. WHERE 用户访问 TaskVista，THE CloudFront SHALL 在 HTTPS 协议下提供服务，不允许 HTTP 明文访问。
5. THE S3 前端托管桶 SHALL 设置桶策略，仅允许 CloudFront Origin Access Control（OAC）访问，拒绝所有直接公网访问。

---

### 需求 11：安全性与 IAM 最小权限

**用户故事：** 作为安全负责人，我希望系统遵循 IAM 最小权限原则，以防止未授权访问和数据泄露。

#### 验收标准

1. THE Lambda SHALL 使用独立的 IAM 执行角色，每个 Lambda 函数的角色仅包含其业务逻辑所需的最小 DynamoDB 操作权限（指定表名和操作类型）。
2. THE Lambda SHALL 在处理所有用户输入（包含 projectId、taskId、commentId 及请求体字段）时进行输入验证，拒绝包含 SQL 注入或 NoSQL 注入模式的输入，返回 HTTP 400 状态码。
3. THE System SHALL 不在代码、环境变量明文或日志中记录 AWS 访问密钥、密码或 JWT 私钥等敏感凭证。
4. THE Cognito SHALL 配置密码策略，要求密码长度不少于 8 个字符，且包含大小写字母与数字的组合。
5. WHEN 已认证用户请求操作不属于自己有权访问的 Project 或 Task，THE Lambda SHALL 返回 HTTP 403 状态码，不暴露目标资源是否存在。

---

### 需求 12：云迁移兼容性

**用户故事：** 作为架构师，我希望系统在架构层面预留迁移至 Google Cloud 的能力，以便在业务需要时能以最小成本完成迁移。

#### 验收标准

1. THE Lambda 业务逻辑代码 SHALL 将所有 AWS SDK 调用封装在独立的 Repository 或 Adapter 层，不在业务逻辑函数中直接引用 AWS SDK。
2. THE System SHALL 使用标准 RESTful API 设计，不使用 AWS 私有协议（如 AppSync GraphQL Subscription、IoT WebSocket）作为前后端通信方式。
3. THE Frontend SHALL 通过 `VITE_API_BASE_URL` 单一入口与后端通信，切换后端云平台时仅需修改该环境变量。
4. THE DynamoDB 数据模型 SHALL 使用 camelCase 属性命名，且核心实体字段（projectId、taskId、title、status、assigneeId、createdAt、updatedAt）与 Google Cloud Firestore 的文档模型兼容。
5. THE System 的 API 文档 SHALL 以 OpenAPI 3.0 规范描述所有端点，为迁移至 Google Cloud Endpoints 提供接口契约。
