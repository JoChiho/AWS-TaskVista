# TaskVista

面向小型开发团队（5–15 人）的任务与项目进度追踪 Web 应用。前端为 Vue 3 + Vuetify 3 SPA，后端为 AWS Serverless（Lambda + API Gateway + DynamoDB + S3 + Cognito）。

## 目录结构

```
AWS-TaskVista/
├── frontend/          # Vue 3 前端
├── backend/           # Lambda 后端（TypeScript）
├── .kiro/             # Kiro 规格文档
├── venv/              # Python 虚拟环境（可选）
└── README.md
```

## 本地开发

### 前提条件

- Node.js 20+
- AWS CLI v2（部署时需要）
- 已配置的 AWS 凭证（`aws configure`）

### 前端

```powershell
cd frontend
npm install
npm run dev
```

浏览器访问 http://localhost:5173。需在 `frontend/.env.development` 中配置 Cognito 与 API 地址。

### 后端

```powershell
cd backend
npm install
npm run build        # 编译到 dist/
npm run type-check   # 类型检查
```

## 单元测试

后端使用 [Vitest](https://vitest.dev/) 进行单元测试，覆盖 Service 层业务逻辑、共享模块与 Handler 路由。

```powershell
cd backend
npm test             # 运行全部测试
npm run test:watch   # 监视模式
```

### 测试范围

| 目录 | 内容 |
|------|------|
| `tests/shared/` | context、response、types |
| `tests/projects/` | 项目 CRUD Service + Handler |
| `tests/tasks/` | 任务 CRUD、状态更新 |
| `tests/comments/` | 评论创建/删除权限 |
| `tests/attachments/` | 文件大小校验、预签名 URL |
| `tests/dashboard/` | 统计聚合、担当任务排序 |

测试通过标准：`48 passed`（全部通过后方可部署）。

---

## AWS 一键部署

手动逐步操作确实很繁琐。项目已提供**自动部署脚本**，在项目根目录执行即可。

### 前提条件

- Node.js 20+
- AWS 凭证已配置（见下方「配置 AWS 凭证」）
- IAM 用户对 Lambda、API Gateway、S3、CloudFront 有部署权限

#### 配置 AWS 凭证

本机若无全局 AWS CLI，项目 `venv` 中已通过 pip 安装了 `awscli`。在项目根目录执行：

```powershell
# 激活 venv 后配置（推荐）
C:\my_workspace\AWS-TaskVista\venv\Scripts\aws.cmd configure
# 依次输入: Access Key ID / Secret Access Key / region: us-east-1 / output: json

# 验证
C:\my_workspace\AWS-TaskVista\venv\Scripts\aws.cmd sts get-caller-identity
```

或使用环境变量（适合 CI）：

```powershell
$env:AWS_ACCESS_KEY_ID = "你的AccessKey"
$env:AWS_SECRET_ACCESS_KEY = "你的SecretKey"
$env:AWS_DEFAULT_REGION = "us-east-1"
```

### 1. 创建配置文件

```powershell
cd C:\my_workspace\AWS-TaskVista
copy deploy.config.example.json deploy.config.json
```

编辑 `deploy.config.json`，至少填写：

| 字段 | 说明 |
|------|------|
| `cloudFrontDomain` | CloudFront 访问地址，如 `https://d1234.cloudfront.net` |
| `cloudFrontDistributionId` | CloudFront Distribution ID（缓存刷新用） |
| `apiGatewayId` | 已有 API 则填写；首次部署留空，由 bootstrap 自动创建 |

### 2. 部署命令

```powershell
# 首次部署（自动创建 Lambda + API Gateway + 路由 + 前端）
npm run deploy:bootstrap

# 日常更新（运行测试 → 编译 → 上传 Lambda → 构建前端 → 同步 S3 → 刷新 CloudFront）
npm run deploy

# 仅更新后端
npm run deploy:backend

# 仅更新前端
npm run deploy:frontend

# 预览将执行的步骤（不实际调用 AWS）
npm run deploy:dry-run
```

### 脚本自动完成的操作

| 步骤 | 内容 |
|------|------|
| 测试 | `backend` 单元测试（48 项） |
| 后端 | TypeScript 编译 → 打包 zip → 上传 5 个 Lambda |
| API（首次） | 创建 HTTP API、JWT Authorizer、13 组路由 |
| 前端 | 注入环境变量 → `vite build` → `s3 sync` → CloudFront 缓存失效 |

脚本源码位于 `scripts/` 目录，可按需修改。

### 3. 首次部署后需手动确认的一次性配置

自动脚本**不会**修改以下已有资源，请在 AWS 控制台确认：

1. **Cognito 回调 URL**：添加 `https://<你的CloudFront域名>/callback` 和 `/login`
2. **CloudFront SPA 回退**：403/404 → `/index.html`（200）
3. **DynamoDB 表** 与 **S3 桶** 已存在且 Lambda 角色有权限

### 已有 AWS 资源

| 资源 | 标识 |
|------|------|
| Region | `us-east-1` |
| Cognito User Pool | `us-east-1_PvLPf6TL0` |
| Cognito App Client | `29taqubn8q5crh7jddgnelqc2q` |
| DynamoDB | `TaskVista-Projects` / `Tasks` / `Comments` |
| S3 前端桶 | `taskvista-frontend` |
| S3 附件桶 | `taskvista-attachments` |
| Lambda 执行角色 | `arn:aws:iam::312310269639:role/TaskVista-Lambda-Execution-Role` |

---

## 环境变量参考

### Lambda（所有函数共用）

| 变量 | 值 |
|------|-----|
| `PROJECTS_TABLE` | `TaskVista-Projects` |
| `TASKS_TABLE` | `TaskVista-Tasks` |
| `COMMENTS_TABLE` | `TaskVista-Comments` |
| `ATTACHMENTS_BUCKET` | `taskvista-attachments` |
| `AWS_REGION` | `us-east-1` |
| `COGNITO_USER_POOL_ID` | `us-east-1_PvLPf6TL0` |

### 前端

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | API Gateway 调用 URL |
| `VITE_COGNITO_*` | Cognito 认证配置 |

---

## 常见问题

**Q: 前端刷新后 404？**  
A: CloudFront 未配置 SPA 回退，需将 403/404 重定向到 `/index.html`。

**Q: API 返回 401？**  
A: 检查 JWT Token 是否过期；API Gateway Authorizer 的 Audience/Issuer 是否与 Cognito 一致。

**Q: Lambda 报 DynamoDB 权限错误？**  
A: 确认 `TaskVista-Lambda-Execution-Role` 对三张表有读写权限。

**Q: 附件上传失败？**  
A: 确认 `taskvista-attachments` 桶存在，Lambda 角色有 `s3:PutObject` 权限。

---

## 许可证

Private — 内部团队使用。