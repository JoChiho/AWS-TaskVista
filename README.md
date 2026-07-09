# TaskVista

面向小型开发团队（5–15 人）的任务与项目进度追踪 Web 应用。前端为 Vue 3 + Vuetify 3 SPA，后端为 AWS Serverless（Lambda + API Gateway + DynamoDB + S3 + Cognito）。

## 目录结构

```
AWS-TaskVista/
├── frontend/          # Vue 3 前端（Vite 本地热更新）
├── backend/           # Lambda 后端 TypeScript + Vitest
├── scripts/           # 部署与运维脚本
├── .kiro/             # 规格 / 设计文档
├── deploy.config.json # 部署配置（勿提交密钥；见 .gitignore）
└── README.md
```

---

## 推荐开发方式（本地优先）

日常修 Bug / 加功能时，**不必每次 `deploy`**。建议：

| 改动类型 | 本地怎么做 | 何时再 deploy |
|----------|------------|----------------|
| 前端 UI、状态、路由 | `frontend` 下 `npm run dev` | 功能稳定后部署前端 |
| 后端业务逻辑 | `backend` 下 `npm test` / `test:watch` | 测试通过后部署后端 |
| 端到端（登录 + 真 API） | 本地前端 + **已部署的** API/Cognito | 仅在需要联调线上数据时 |

后端是 Lambda，没有单独的 `npm run dev` HTTP 服务；逻辑验证以 **Vitest 单元测试** 为主，联调时连云端 API。

---

## 1. 环境准备

```powershell
# 需要 Node.js 20+
node -v

# 安装依赖（首次，或 package.json 变更后）
cd C:\my_workspace\AWS-TaskVista\frontend
npm install

cd C:\my_workspace\AWS-TaskVista\backend
npm install
```

部署到 AWS 时才需要 AWS CLI 与凭证；纯前端开发 + 后端单测可以不配置 AWS。

---

## 2. 前端本地运行

### 2.1 配置环境变量

```powershell
cd C:\my_workspace\AWS-TaskVista\frontend
copy .env.example .env.development
```

编辑 `frontend/.env.development`（示例，请按你的 `deploy.config.json` 填写）：

```env
# 指向已部署的 API（本地前端 + 云端后端联调）
VITE_API_BASE_URL=https://65suijwhx5.execute-api.us-east-1.amazonaws.com/prod

VITE_COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0
VITE_COGNITO_CLIENT_ID=2ouhcok50mfbsek9q3b1cg8d1h
VITE_COGNITO_DOMAIN=https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback
```

### 2.2 启动开发服务器

```powershell
cd C:\my_workspace\AWS-TaskVista\frontend
npm run dev
```

浏览器打开：**http://localhost:5173**

修改 `src/` 下 Vue/TS 会热更新，保存即生效。

### 2.3 Cognito 本地回调（必须）

在 AWS Cognito → 应用客户端 → 托管 UI / 回调 URL 中，确保包含：

| 类型 | URL |
|------|-----|
| 回调 URL | `http://localhost:5173/callback` |
| 登出 URL | `http://localhost:5173/login` |

同时保留线上 CloudFront 的 callback/login。未配置时本地登录会跳转失败。

### 2.4 前端其他命令

```powershell
cd frontend
npm run type-check   # vue-tsc 类型检查
npm run build        # 生产构建（dist/）
npm run preview      # 预览构建结果
npm run lint         # ESLint / oxlint
npm run format       # Prettier
```

---

## 3. 后端本地开发与测试

后端以 **单元测试驱动** 开发：改 `backend/src/` → 跑测试 → 通过后再 deploy。

```powershell
cd C:\my_workspace\AWS-TaskVista\backend

npm test             # 跑完全部单元测试（当前约 53 项）
npm run test:watch   # 监视模式：改文件自动重跑（推荐日常开发）
npm run type-check   # tsc --noEmit
npm run build        # 编译到 dist/（部署前脚本会自动执行）
```

### 测试覆盖

| 目录 | 内容 |
|------|------|
| `tests/shared/` | context、response、types、权限 |
| `tests/projects/` | 项目 CRUD、成员添加/删除 |
| `tests/tasks/` | 任务 CRUD、状态更新 |
| `tests/comments/` | 评论创建/删除权限 |
| `tests/attachments/` | 文件大小、预签名 URL |
| `tests/dashboard/` | 统计聚合、担当任务 |

测试用 mock，**不访问真实 AWS**，可离线反复跑。

### 建议工作流（后端）

```text
1. 在 backend/src 修改逻辑
2. 在 backend/tests 补充或改测试用例
3. npm run test:watch  确认通过
4. 需要联调真实 DynamoDB / Cognito 时再：
   cd ..  &&  npm run deploy:backend
```

---

## 4. 本地前端 + 云端 API 联调

适合验证：登录、项目成员、评论、担当者、真实 DynamoDB 数据。

```powershell
# 终端 1：只开前端
cd frontend
npm run dev
```

- API 走 `VITE_API_BASE_URL`（已部署的 API Gateway）
- 登录走 Cognito Hosted UI，回调回 `localhost:5173`
- 改前端代码立即可见；**后端改动需 deploy:backend 后才影响联调结果**

纯前端逻辑（布局、表单校验、Pinia 状态）不必等 deploy。

---

## 5. 常用命令速查（PowerShell）

在仓库根目录 `C:\my_workspace\AWS-TaskVista`：

```powershell
# ---------- 前端本地开发 ----------
cd frontend; npm install; npm run dev

# ---------- 后端测试 ----------
cd backend; npm install; npm test
cd backend; npm run test:watch

# ---------- 类型检查 ----------
cd frontend; npm run type-check
cd backend; npm run type-check

# ---------- 部署（功能稳定后再做）----------
npm run deploy:backend     # 仅 Lambda
npm run deploy:frontend    # 仅 S3 + CloudFront
npm run deploy             # 后端 + 前端
npm run deploy:dry-run     # 只打印步骤，不调 AWS
npm run deploy:bootstrap   # 首次：Lambda + API 路由等
```

---

## 6. AWS 部署（简要）

部署脚本：`scripts/deploy.mjs`。配置文件：`deploy.config.json`（从 `deploy.config.example.json` 复制）。

### AWS 凭证

```powershell
aws configure
# 或
aws sts get-caller-identity
```

**不要把 Access Key / Secret 写进 README 或提交到 Git。**

### 部署后地址（当前环境示例）

| 用途 | 地址 |
|------|------|
| 生产前端 | https://d11ymhapp7f3dt.cloudfront.net |
| API | https://65suijwhx5.execute-api.us-east-1.amazonaws.com/prod |
| 本地前端 | http://localhost:5173 |

### 部署脚本会做什么

| 步骤 | 内容 |
|------|------|
| 测试 | 运行 `backend` 单元测试 |
| 后端 | `tsc` → zip → 更新 5 个 Lambda |
| 前端 | 注入 env → `vite build` → `s3 sync` → CloudFront 失效 |

### 已有 AWS 资源（参考）

| 资源 | 标识 |
|------|------|
| Region | `us-east-1` |
| Cognito User Pool | `us-east-1_PvLPf6TL0` |
| Cognito App Client | 见 `deploy.config.json` 的 `cognito.clientId` |
| DynamoDB | `TaskVista-Projects` / `TaskVista-Tasks` / `TaskVista-Comments` |
| S3 前端桶 | `taskvista-frontend` |
| S3 附件桶 | `taskvista-attachments` |

---

## 7. 环境变量参考

### Lambda（`deploy.config.json` → `lambdaEnvironment`）

| 变量 | 说明 |
|------|------|
| `PROJECTS_TABLE` | 项目表名 |
| `TASKS_TABLE` | 任务表名 |
| `COMMENTS_TABLE` | 评论表名 |
| `ATTACHMENTS_BUCKET` | 附件 S3 桶 |
| `COGNITO_USER_POOL_ID` | 用户池 ID（成员邀请查邮箱用） |

### 前端（`.env.development` / 部署时注入）

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | API Gateway 根 URL（含 `/prod`） |
| `VITE_COGNITO_USER_POOL_ID` | User Pool ID |
| `VITE_COGNITO_CLIENT_ID` | App Client ID |
| `VITE_COGNITO_DOMAIN` | Hosted UI 域名 |
| `VITE_COGNITO_REDIRECT_URI` | 本地为 `http://localhost:5173/callback` |

---

## 8. 常见问题

**Q: 本地改了前端，线上没变化？**  
A: 正常。本地只影响 `localhost`。上线需 `npm run deploy:frontend`。

**Q: 本地改了 backend/src，联调没效果？**  
A: 本地前端连的是云端 Lambda。请先 `cd backend && npm test`，再 `npm run deploy:backend`。

**Q: 本地登录后跳回错误域名？**  
A: Cognito 回调 URL 未加 `http://localhost:5173/callback`。

**Q: API 401？**  
A: Token 过期请重新登录；确认 `VITE_COGNITO_CLIENT_ID` 与 API Gateway JWT Authorizer 的 Audience 一致。

**Q: 前端刷新 404（CloudFront）？**  
A: 需配置 SPA 回退：403/404 → `/index.html`。

**Q: 附件上传失败？**  
A: 确认 `taskvista-attachments` 桶与 Lambda 角色的 S3 权限。

---

## 许可证

Private — 内部团队使用。
