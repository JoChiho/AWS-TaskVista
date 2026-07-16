---
inclusion: always
---

# TaskVista 向け AWS Serverless ベストプラクティス

## 共通原則
- Serverless サービスを優先し、Free Tier を最大限活用する
- Lambda：Node.js を使用し、コールドスタートに配慮する。構造化 JSON ログ（correlationId 付き）を出力する
- DynamoDB：MVP では複数テーブル（Projects / Tasks / Comments）。将来は単一テーブル + GSI へ進化させる
- S3：添付は `tasks/{taskId}/` プレフィックスで整理し、ライフサイクルルールを設定する
- Cognito：User Pools + Hosted UI、またはカスタムログインページを使用する
- API Gateway：HTTP API（コスト効率が良い）を使用し、CORS を有効にする
- セキュリティ：IAM 最小権限、入力検証、認証情報のハードコード禁止
- 可観測性：CloudWatch Logs + 構造化メトリクス
- 移行しやすさ：すべての API は標準 REST とし、ベンダーロックインを避ける
