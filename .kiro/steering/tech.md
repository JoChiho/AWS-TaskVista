---
inclusion: always
---

# TaskVista 技術スタック

## フロントエンド
- Vue 3 + TypeScript + Composition API（`<script setup>`）
- Vuetify 3（UI コンポーネントライブラリ）
- Pinia（状態管理）
- Vue Router
- vuedraggable（Kanban ドラッグ）
- Axios（API 呼び出し）

## バックエンド（AWS Serverless）
- AWS Lambda（Node.js 優先、フロントエンドと揃える）
- Amazon API Gateway（HTTP API）
- Amazon Cognito（認証）
- Amazon DynamoDB（NoSQL データベース）
- Amazon S3（静的ホスティング + 添付ストレージ）
- Amazon CloudFront（CDN）
- Amazon CloudWatch（ログ監視）

## アーキテクチャ原則
- 純 Serverless とし、Free Tier を最大限活用する
- フロントエンドは完全に疎結合し、環境変数 `VITE_API_BASE_URL` でバックエンドを設定する
- RESTful API 設計とし、将来の Google Cloud 移行（Cloud Run + Firestore + GCS）を容易にする
- IAM 最小権限 + 構造化ログ
