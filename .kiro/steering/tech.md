---
inclusion: always
---

# TaskVista 技术栈

## 前端
- Vue 3 + TypeScript + Composition API (<script setup>)
- Vuetify 3（UI 组件库）
- Pinia（状态管理）
- Vue Router
- vuedraggable（Kanban 拖拽）
- Axios（API 调用）

## 后端（AWS Serverless）
- AWS Lambda（Node.js 优先，与前端保持一致）
- Amazon API Gateway（HTTP API）
- Amazon Cognito（认证）
- Amazon DynamoDB（NoSQL 数据库）
- Amazon S3（静态托管 + 附件存储）
- Amazon CloudFront（CDN）
- Amazon CloudWatch（日志监控）

## 架构原则
- 纯 Serverless，充分利用 Free Tier
- 前端完全解耦，通过环境变量 VITE_API_BASE_URL 配置后端
- RESTful API 设计，便于未来迁移 Google Cloud（Cloud Run + Firestore + GCS）
- IAM 最小权限 + 结构化日志