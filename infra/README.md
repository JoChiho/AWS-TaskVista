# TaskVista Infrastructure (AWS CDK)

Auth / Storage / Backend / Frontend を **一括管理** する CDK アプリです。  
既存の手動リソース（Cognito / DynamoDB / S3）と `scripts/deploy.mjs` によるコードデプロイから、段階的に移行できます。

## ディレクトリ

```
infra/
├── bin/taskvista.ts          # エントリ（-c env=dev|prod）
├── lib/
│   ├── config.ts             # 環境別設定・命名規則
│   ├── taskvista-stack.ts    # 親スタック（Nested 合成）
│   └── stacks/
│       ├── auth-stack.ts     # Cognito User Pool / Client / Identity Pool
│       ├── storage-stack.ts  # DynamoDB ×4 + S3 ×2
│       ├── backend-stack.ts  # Lambda ×5 + HTTP API + JWT Authorizer
│       └── frontend-stack.ts # CloudFront + OAC（S3 は Storage 参照）
├── cdk.json
├── package.json
└── tsconfig.json
```

## スタック構成

| Nested Stack | リソース |
|---|---|
| **Auth** | User Pool, App Client (SPA), Hosted UI Domain, Identity Pool |
| **Storage** | Projects / Tasks / Comments / Users 表, attachments バケット |
| **Backend** | 5 Lambda, HTTP API, Cognito JWT Authorizer, IAM 最小権限 |
| **Frontend** | SPA 用 S3 + CloudFront + OAC（OAC 循環参照回避のため同スタック） |

```
TaskVista-{env}
├── Auth
├── Storage   ← DynamoDB + 添付 S3
├── Frontend  ← SPA S3 + CloudFront（OAC は同スタック必須）
└── Backend   ← Auth + Storage
```

## DynamoDB 設計（アプリ実装準拠）

| テーブル | PK | SK | GSI |
|---|---|---|---|
| Projects | `projectId` | — | `CreatedByIndex` (`createdBy`) |
| Tasks | `projectId` | `taskId` | `TaskIdIndex` (`taskId`), `ProjectStatusIndex` (`projectId`,`status`), `AssigneeIndex` (`assigneeId`,`dueDate`) |
| Comments | `taskId` | `commentId` | — |
| Users | `userId` | — | — |

進捗は `Task.completionPercent` / `status` で持つため **ProgressLogs テーブルは不要** です。

## セットアップ

```bash
cd infra
npm install

# 初回のみ（アカウント/リージョン）
npx cdk bootstrap aws://ACCOUNT/us-east-1

# 合成確認
npx cdk synth -c env=dev

# デプロイ
npx cdk deploy -c env=dev --all
# または
npm run deploy:dev
```

## デプロイ後のフロントエンド反映

CloudFormation Outputs の `FrontendEnvHint` を使い、フロントをビルドして S3 に同期します。

```bash
# Outputs 例（実際の値に置換）
export VITE_API_BASE_URL=https://xxxx.execute-api.us-east-1.amazonaws.com
export VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxx
export VITE_COGNITO_CLIENT_ID=xxxxx
export VITE_COGNITO_DOMAIN=https://taskvista-dev.auth.us-east-1.amazoncognito.com
export VITE_COGNITO_REDIRECT_URI=https://dxxxxx.cloudfront.net/callback

cd ../frontend
npm run build

aws s3 sync dist/ s3://$(aws cloudformation describe-stacks \
  --stack-name TaskVista-dev \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text) --delete

aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

既存の `npm run deploy:frontend`（`deploy.config.json`）も、Outputs の値を config に書けば継続利用できます。

## Cognito コールバック

初回デプロイ時点では CloudFront URL が未確定なため、`config.ts` には localhost と（prod の）カスタムドメインを入れています。  
デプロイ後に CloudFront URL が分かったら:

1. `infra/lib/config.ts` の `additionalCallbackUrls` / `additionalLogoutUrls` に  
   `https://{distribution}.cloudfront.net/callback` 等を追加して再 `cdk deploy`
2. または Cognito コンソールで App Client のコールバック URL を手動追加

## 既存手動リソースの移行（prod）

**重要: 同名リソースが既にある場合、CDK は新規作成に失敗します。**

### 方針 A: グリーンフィールド（dev / 新アカウント）— 推奨

`env=dev` で別名リソースを作り、動作確認後に DNS を切り替え。

### 方針 B: 既存リソースを CDK に取り込む（import）

1. `cdk synth` で論理 ID を確認  
2. リソースマッピング JSON を作成  
3. `cdk import TaskVista-prod`  

例（抜粋）:

```json
{
  "Auth/UserPool": { "UserPoolId": "us-east-1_PvLPf6TL0" },
  "Storage/ProjectsTable": { "TableName": "TaskVista-Projects" },
  "Storage/FrontendBucket": { "BucketName": "taskvista-frontend" }
}
```

テーブル名は `useLegacyResourceNames: true`（prod）で既存名と一致させています。

### 方針 C: データ移行

1. CDK で新テーブル/バケットを作成  
2. DynamoDB Export/Import または 自作コピー  
3. アプリの環境変数を切替  
4. 旧リソースは保持のうえ段階削除  

## RemovalPolicy

| env | DynamoDB / S3 |
|---|---|
| dev | `DESTROY`（バケットは `autoDeleteObjects`） |
| prod | `RETAIN` |

## カスタムドメイン（taskvista-navino.net）

1. us-east-1 で ACM 証明書を発行・検証  
2. `config.ts` の prod.domain.certificateArn を設定  
3. 任意で `hostedZoneId` を設定（Route53 エイリアス作成）  
4. 再デプロイ  

## 注意事項

- HTTP API は **`$default` ステージ**（URL に `/prod` が付かない）。既存フロントが `/prod` 付きなら `VITE_API_BASE_URL` を Outputs の `ApiUrl` に合わせてください。  
- Lambda 関数名は `TaskVista-{env}-projects` 形式（従来の `taskvista-projects` とは別物）。既存 Lambda と並行可能。  
- Identity Pool は作成済みですが、現状アプリは Presigned URL のみ使用（認証ロールは最小権限）。  
- `cdk destroy -c env=prod` しても RETAIN リソースは残ります。  
