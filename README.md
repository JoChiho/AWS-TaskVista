# TaskVista

面向小型开发团队（5–15 人）的任务与项目进度追踪 Web 应用。前端为 Vue 3 + Vuetify 3 SPA，后端为 AWS Serverless（Lambda + API Gateway + DynamoDB + S3 + Cognito）。

## 目录结构

```
AWS-TaskVista/
├── frontend/          # Vue 3 前端（Vite 本地热更新）
├── backend/           # Lambda 后端 TypeScript + Vitest + dist/
├── docs/              # 系统说明 · 机能介绍 · WBS 方案
├── scripts/           # 部署 + 本地 API / SAM 脚本
├── template.yaml      # AWS SAM 模板（sam local）
├── env/local.json     # SAM / 本地 Lambda 环境变量
├── samconfig.toml     # SAM CLI 默认参数
├── deploy.config.json # 生产部署配置
└── README.md
```

## 文档索引

| 文档 | 对象 | 说明 |
|------|------|------|
| [`docs/TaskVista-機能紹介.html`](docs/TaskVista-機能紹介.html) | 利用者 | 功能说明（予定/実績 · WBS 親子 · 三画面） |
| [`docs/TaskVista-システム説明.html`](docs/TaskVista-システム説明.html) | 开发/运维 | 架构 · 数据模型 · API |
| [`docs/WBSタスク管理-修正方案.md`](docs/WBSタスク管理-修正方案.md) | 设计 | WBS 修正方案 **v1.0（Phase 1 已关门）** |

**Phase 1（已交付）**：Task 自引用父子、`wbsCode`、读时 rollup、表树 / 看板叶子 / 详情面包屑。  
**Phase 2（下一步）**：WBS 专用构成画面、同级排序持久化、重编号 UI、时间线父条。

---

## 推荐开发方式（本地优先）

日常修 Bug / 加功能时，**不必每次 `deploy`**。

| 改动类型 | 本地怎么做 | 何时再 deploy |
|----------|------------|----------------|
| 前端 UI、状态、路由 | `frontend` → `npm run dev` | 稳定后 `deploy:frontend` |
| 后端业务逻辑 | Vitest + **本地 Lambda API** | 稳定后 `deploy:backend` |
| 端到端联调 | 前端 :5173 + 本地 API :3001 + 云端 DynamoDB/Cognito | 功能完成后再 deploy |

### 本地后端两条路径

| 路径 | 命令 | 依赖 | 说明 |
|------|------|------|------|
| **B. Node Local API（推荐先用）** | `npm run local:api` | 仅 Node + AWS 凭证 | 无 Docker，直接调 `backend/dist` handler |
| **A. SAM Local** | `npm run local:sam` | **Docker Desktop + SAM CLI** | 更接近生产冷启动/容器 |

两者都连 **真实 AWS** 表/桶/用户池（用本机 `aws configure` 凭证），只是 Lambda **进程在本地执行**。

```
frontend :5173  ──►  local API :3001  ──►  本地 handler (dist)
                              │
                              └──►  DynamoDB / Cognito / S3（云端）
```

---

## 1. 环境准备

```powershell
# Node.js 20+
node -v

cd C:\my_workspace\AWS-TaskVista\frontend
npm install

cd C:\my_workspace\AWS-TaskVista\backend
npm install

# 本地 API 访问真实 DynamoDB 需要 AWS 凭证
aws sts get-caller-identity
```

### （可选）SAM Local 额外依赖

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) — 保持运行  
2. [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)  
3. 验证：`sam --version` / `docker version`

未安装时请用 `npm run local:api`。

---

## 2. 三终端：完整本地联调（改前后端）

### 终端 1 — 编译后端

```powershell
cd C:\my_workspace\AWS-TaskVista
npm run local:build
# 改代码后重复执行；或:
cd backend
npx tsc -w
```

### 终端 2 — 本地 Lambda API（:3001）

```powershell
# 在仓库根目录：
cd C:\my_workspace\AWS-TaskVista
npm run local:api

# 或在 backend 目录也可以（脚本已转发到根目录）：
# cd C:\my_workspace\AWS-TaskVista\backend
# npm run local:build
# npm run local:api

# 已装 Docker + SAM 时：
# npm run local:sam
```

看到 `URL: http://127.0.0.1:3001` 即成功。

**认证方式：**

1. **正常联调**：前端 Cognito 登录，请求自动带 ID Token  
2. **curl / 快速 mock**（`LOCAL_DEV=1`，默认开启）：

```powershell
curl http://127.0.0.1:3001/projects `
  -H "X-Dev-User-Sub: your-cognito-sub" `
  -H "X-Dev-User-Email: you@example.com" `
  -H "X-Dev-User-Name: テスト"
```

改 `backend/src` 后：再跑 `npm run local:build`，**重启** `local:api`（或设 `FORCE_RELOAD=1`）。

### 终端 3 — 前端

```powershell
cd C:\my_workspace\AWS-TaskVista\frontend
# .env.development 中应为:
# VITE_API_BASE_URL=http://127.0.0.1:3001
npm run dev
```

浏览器：**http://localhost:5173**

### Cognito 本地回调（必须）

| 类型 | URL |
|------|-----|
| 回调 | `http://localhost:5173/callback` |
| 登出 | `http://localhost:5173/login` |

在 Cognito 应用客户端中与线上 CloudFront URL 一并配置。

---

## 3. 前端本地命令

```powershell
cd frontend
npm run dev          # 开发服务器
npm run type-check
npm run build
npm run preview
npm run lint
```

`.env.development` 示例：

```env
# 本地 Lambda API（Node 或 SAM）
VITE_API_BASE_URL=http://127.0.0.1:3001

# 若要改回「前端本地 + 云端 API」则改为:
# VITE_API_BASE_URL=https://65suijwhx5.execute-api.us-east-1.amazonaws.com/prod

VITE_COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0
VITE_COGNITO_CLIENT_ID=2ouhcok50mfbsek9q3b1cg8d1h
VITE_COGNITO_DOMAIN=https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback
```

---

## 4. 后端单元测试（不启 HTTP）

改 Service 逻辑时先用 Vitest（不访问 AWS）：

```powershell
cd backend
npm test
npm run test:watch
npm run type-check
```

| 目录 | 内容 |
|------|------|
| `tests/shared/` | context、response、types |
| `tests/projects/` | 项目 / 成员 |
| `tests/tasks/` | 任务 |
| `tests/comments/` | 评论 |
| `tests/attachments/` | 附件 |
| `tests/dashboard/` | 仪表盘 |

建议：`test:watch` 绿 → `local:build` + 重启 `local:api` → 浏览器验证 → 最后 `deploy:backend`。

---

## 5. SAM 相关文件说明

| 文件 | 作用 |
|------|------|
| `template.yaml` | 5 个 Function + HTTP API 路由（与线上一致） |
| `env/local.json` | `sam local --env-vars` 表名 / 池 ID |
| `samconfig.toml` | 默认端口 3001 等 |
| `scripts/local-api.mjs` | 无 Docker 的本地网关 |
| `scripts/local-jwt.mjs` | 解析 Bearer JWT / Dev mock 头 |
| `scripts/local-sam.mjs` | 封装 `sam local start-api` |
| `scripts/local-build.mjs` | `backend` tsc 编译 |

---

## 6. 常用命令速查

```powershell
cd C:\my_workspace\AWS-TaskVista

# ---------- 本地 Lambda + 前端 ----------
npm run local:build          # 编译 backend → dist
npm run local:api            # 本地 API :3001（推荐）
npm run local:sam            # SAM Local（需 Docker）
# 在 backend 目录也可: cd backend; npm run local:build; npm run local:api

cd frontend; npm run dev     # 前端 :5173

# ---------- 仅单测 ----------
cd backend; npm run test:watch

# ---------- 部署（推荐在仓库根目录）----------
npm run deploy:backend
npm run deploy:frontend
npm run deploy
npm run deploy:dry-run

# 子目录也可以（已转发到根脚本）:
# cd backend  →  npm run deploy:backend
# cd frontend →  npm run deploy:frontend
```

---

## 7. AWS 部署（简要）

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

## 8. 环境变量参考

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

## 9. 常见问题

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
