---
inclusion: always
---

# TaskVista AWS リソース設定（Kiro は必ず遵守）

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

## 共通設定
- Region: `us-east-1`
- すべての Lambda は Node.js 18 以上を使用する
- API Gateway は HTTP API を使用する
- フロントエンドは環境変数 `VITE_API_BASE_URL` でバックエンドを呼び出す
- すべての操作は上記の既存リソースを使用し、新規リソースは作成しない
