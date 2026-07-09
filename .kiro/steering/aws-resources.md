---
inclusion: always
---

# TaskVista AWS 资源配置（Kiro 必须遵守）

## Cognito
- User Pool ID: `us-east-1_PvLPf6TL0` 
- App Client ID: `29taqubn8q5crh7jddgnelqc2q`
- Region: `us-east-1` 
- Hosted UI Domain: `https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com` 

## DynamoDB
- Projects Table: `TaskVista-Projects`
- Tasks Table: `TaskVista-Tasks`
- Comments Table: `TaskVista-Comments`
- Region: `us-east-1`

## S3 Buckets
- Frontend Bucket: `taskvista-frontend` 
- Attachments Bucket: `taskvista-attachments`

## IAM
- Lambda Execution Role ARN: `arn:aws:iam::312310269639:role/TaskVista-Lambda-Execution-Role`

## 通用配置
- Region: `us-east-1`
- 所有 Lambda 使用 Node.js 18+
- API Gateway 使用 HTTP API
- 前端使用环境变量 `VITE_API_BASE_URL` 调用后端
- 所有操作必须使用上述已有资源，不要创建新资源