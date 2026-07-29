# TaskVista 开发命令书

## 适用范围

- 本文件适用于整个 `AWS-TaskVista` 仓库。
- `.kiro/steering/` 与 `.kiro/specs/` 是重要的历史设计资料；开始相关工作前应按需阅读，但必须与当前代码、测试、README、IaC 和实际部署配置交叉核对。
- 如果将来在 `frontend/`、`backend/` 或 `infra/` 下增加更具体的 `AGENTS.md`，则子目录规则优先于本文件。

## 产品定位

- TaskVista 是面向小型开发团队的项目、WBS 和任务管理 Web 应用。
- 核心功能包括项目与成员管理、任务 CRUD、Kanban、表格、时间线、WBS、评论、附件、交付物和 Dashboard。
- 功能更新必须优先保护既有用户数据、访问权限、API 兼容性和主要操作流程。
- 架构应保持业务层与云厂商 SDK 尽量解耦，为 AWS 持续运行及未来迁移至 Google Cloud 保留空间。

## 开发工作方式

- 修改前先阅读相关代码、类型、测试、文档和调用方，不根据文件名或旧文档猜测当前行为。
- 先确定根因或需求边界，再实施最小且完整的修改。
- 不进行与当前任务无关的大规模重构、依赖升级或格式化。
- 不覆盖、回退或删除不属于当前任务的已有修改。
- 新增生产依赖、改变 API 合约、修改持久化模型或认证流程前，先说明影响、兼容方案和迁移方案。
- 对信息不一致的配置，实际来源优先级为：当前 IaC/部署输出与环境变量 → 当前运行代码 → README/docs → `.kiro` 历史资料。
- 云资源 ID、账号 ID、域名和 ARN 不应重复写入本文件；不得在代码或文档中写入密码、访问密钥、token、私钥或其他秘密。

## 语言与文案

- 与项目负责人沟通、任务总结和开发说明默认使用中文。
- 所有面向用户的 UI 文案、错误信息和成功信息使用自然、专业、适合日系企业的日语。
- 代码注释使用自然的日语；变量名、函数名、类型名和文件名使用英文。
- 修改已有日语文案时保持产品术语一致，尤其是状态：`未着手`、`進行中`、`レビュー待ち`、`完了`、`保留`。
- 避免引入乱码；读写现有文本文件时使用 UTF-8。

## 前端规范

- 使用 Vue 3、TypeScript、Composition API 和 `<script setup>`。
- 状态管理使用 Pinia；HTTP 请求通过 `frontend/src/api/` 的现有客户端和模块。
- 优先使用 Vuetify 3 组件及主题变量，独自 CSS 保持最少。
- Vue 组件使用 PascalCase；页面组件以 `View.vue` 结尾。
- Props 和 emits 必须有明确的 TypeScript 类型。
- 不随意改变现有路由、API 字段、状态值和用户操作习惯。
- 修改任务模型或状态逻辑时，检查 Kanban、表格、时间线、WBS、详情页和 Dashboard 的共同影响。

## 后端规范

- 使用 TypeScript strict mode，并保持 `handler → service → repository` 分层。
- handler 负责 HTTP 路由适配；service 负责业务规则和授权；repository 负责持久化与云服务访问。
- 输入使用 Zod 或现有验证机制校验，错误使用现有错误类型和响应结构。
- 所有项目、任务、评论、附件、成员和 Dashboard 数据访问必须验证当前用户权限。
- 日志保留 `correlationId`，使用结构化日志；不得记录认证 token、秘密或不必要的个人信息。
- 保持 REST API 路径和响应字段向后兼容；必须变更时提供兼容期或明确迁移方案。
- 避免在业务 service 中直接散布 AWS 或 GCP SDK 调用；云厂商实现应集中在 repository、adapter 或 shared infrastructure 层。

## WBS 与业务不变量

- `parentTaskId`、`wbsCode` 和 `sortOrder` 必须保持层级与排序一致。
- 移动、重排、软删除或恢复任务时，必须考虑全部后代节点和同级节点。
- 防止任务成为自身或其后代的子任务，防止 WBS 循环。
- 父任务 rollup 不得破坏子任务的工时、日期、状态、完成率、负责人和评审人数据。
- 修改状态、负责人、日期、工时或完成率逻辑时，同时验证父级汇总和 Dashboard 聚合。
- 删除业务记录优先保持现有软删除语义，除非需求明确要求永久删除。
- 项目成员、负责人、评审人和评论作者的用户 ID 变更必须保留可靠映射。

## 附件与认证

- 附件必须保持项目访问控制、50 MB 文件大小限制、元数据一致性和临时签名 URL 机制。
- 对象路径应保持 `tasks/{taskId}/...` 的组织方式，除非有经过迁移验证的新方案。
- 前端不得持有云服务秘密或服务账号凭据。
- 修改认证时必须验证登录、回调、token 刷新、退出、会话恢复和 401 处理。
- Cognito 或未来 Identity Platform 的身份迁移必须保护现有项目成员关系和历史作者关系。

## 基础设施与部署安全

- 当前生产架构为 AWS Serverless；`infra/` 中的 AWS CDK 是基础设施定义的重要来源。
- 修改 IaC 前先运行 build、synth、diff、plan 或等价的只读检查。
- 未经用户明确要求和授权，不执行生产部署、CDK deploy、资源创建、资源删除、数据库迁移、数据写入或凭据变更。
- `deploy`、`deploy:prod`、`destroy:*`、带 `--delete` 的同步命令及其他可能改变云资源的命令都视为外部状态变更。
- 不假设 `.kiro/steering/aws-resources.md`、`deploy.config.json` 或 README 中的资源标识仍然一致；执行云操作前必须读取实际部署状态。
- 为 Google Cloud 编写迁移代码时，应与现有 AWS 版本隔离，优先经过 staging 和数据核对后再考虑切换。

## 验证命令

根据修改范围运行最小但充分的验证。除非环境阻塞，否则交付前至少执行对应模块的 type-check、测试和构建。

### 前端

```powershell
npm --prefix frontend run type-check
npm --prefix frontend run test
npm --prefix frontend run build
```

- `npm --prefix frontend run lint` 当前包含自动修复；仅在相关变更需要时运行，并在运行后检查 diff。
- UI、路由、认证、拖拽、时间线或响应式布局发生变化时，还应进行浏览器级验证。

### 后端

```powershell
npm --prefix backend run type-check
npm --prefix backend run test
npm --prefix backend run build
```

- 修改 repository、授权或路由时，优先增加覆盖成功、失败、无权限和不存在资源场景的测试。

### 基础设施

```powershell
npm --prefix infra run build
npm --prefix infra run synth
```

- 若 synth 需要真实账号、网络或云权限而无法安全执行，应说明未验证原因，不得假称通过。

## 测试与质量

- 修复 Bug 时尽可能先添加或确认能复现问题的测试，再实施修复。
- 新功能至少覆盖正常流程、验证失败、权限边界、空数据和既有数据兼容性。
- 测试与实现必须使用相同的业务状态、类型和 API 合约，避免只为测试建立平行逻辑。
- 不得删除或放宽测试来掩盖回归；需要调整测试时说明行为变化理由。
- 不声称测试或构建通过，除非已经实际执行并确认退出码成功。

## 文档与交付

- 行为、API、部署方式、环境变量、数据模型或架构发生变化时，同步更新 README 或 `docs/`。
- 重要设计决定写入仓库文档，不只保留在聊天记录中。
- 完成任务后简洁说明：
  - 修改了什么；
  - 主要影响文件；
  - 运行了哪些检查及结果；
  - 尚未验证的内容、已知风险或后续工作。

## Code Review Rules

- 检查 API 路径、响应字段、任务状态、用户身份字段和附件元数据的破坏性变更；安全路径是保留旧字段或提供明确兼容迁移。
- 检查所有读取和写入是否维持项目成员权限边界；安全路径是在 service 层复用统一授权检查。
- 检查 WBS 操作是否可能产生循环、孤儿节点、重复 `wbsCode` 或不连续 `sortOrder`；安全路径是验证整棵受影响子树并原子化更新。
- 检查日志、前端变量、配置和文档是否泄露秘密或个人敏感信息；安全路径是使用环境变量、Secret Manager 或云端秘密服务。
- 检查部署脚本和 IaC 是否可能误用生产环境、删除持久化数据或扩大 IAM 权限；安全路径是默认 staging、先 diff，并要求明确批准。
