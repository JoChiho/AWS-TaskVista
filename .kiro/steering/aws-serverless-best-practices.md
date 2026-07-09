---
inclusion: always
---

# AWS Serverless Best Practices for TaskVista

## 通用原则
- 优先使用 Serverless 服务，充分利用 Free Tier
- Lambda：Node.js，保持冷启动友好，添加结构化 JSON 日志（带 correlationId）
- DynamoDB：MVP 用多表（Projects / Tasks / Comments），未来演进单表 + GSI
- S3：附件使用 `tasks/{taskId}/` 前缀组织，设置生命周期规则
- Cognito：使用 User Pools + Hosted UI 或自定义登录页
- API Gateway：使用 HTTP API（更便宜），启用 CORS
- 安全性：IAM 最小权限、输入验证、避免硬编码凭证
- 可观测性：CloudWatch Logs + 结构化指标
- 迁移友好：所有 API 使用标准 REST，避免 vendor lock-in