# 設計ドキュメント

## 概要

TaskVista はフロントエンドとバックエンドを完全分離した Serverless アーキテクチャを採用する。フロントエンドは Vue 3 + Vuetify 3 の SPA で CloudFront + S3 から配信し、バックエンドは AWS Lambda + API Gateway HTTP API で構成する。データは DynamoDB 多テーブル設計で永続化し、ユーザー認証は Cognito User Pools で管理する。AWS SDK の呼び出しはすべて Repository 層に封じ込め、Google Cloud への移行時もコアビジネスロジックを変更せずに済む構造とする。

---

## アーキテクチャ図

```
ユーザーブラウザ
    │
    ▼
[CloudFront CDN]  ──────────────────────────────────────────────────
    │                                                               │
    ▼                                                               ▼
[S3: taskvista-frontend]                          [API Gateway HTTP API]
 (フロントエンド SPA)                                               │
                                                    ┌───────────────┼───────────────┐
                                                    ▼               ▼               ▼
                                             [Lambda:           [Lambda:        [Lambda:
                                              Projects]          Tasks]          Comments /
                                                    │               │            Attachments]
                                                    └───────────────┼───────────────┘
                                                                    ▼
                                                    ┌───────────────────────────────┐
                                                    │         Amazon DynamoDB        │
                                                    │  TaskVista-Projects            │
                                                    │  TaskVista-Tasks               │
                                                    │  TaskVista-Comments            │
                                                    └───────────────────────────────┘
                                                                    │
                                                    [S3: taskvista-attachments]
                                                    (tasks/{taskId}/ プレフィックス)

[Amazon Cognito: us-east-1_PvLPf6TL0]  ◄── JWT 認証 ──► [API Gateway Authorizer]
[Amazon CloudWatch] ◄── 構造化ログ ──► [すべての Lambda 関数]
```

---

## 技術選定

| レイヤー | 技術 | 採用理由 |
|---------|------|---------|
| フロントエンドフレームワーク | Vue 3 + TypeScript + `<script setup>` | Composition API による優れた型推論とロジック再利用 |
| UI コンポーネントライブラリ | Vuetify 3 | Material Design 完備、レスポンシブグリッド内蔵 |
| 状態管理 | Pinia | 軽量かつ型安全、Vuex の後継 |
| ルーティング | Vue Router 4 | History モード + CloudFront カスタムエラーページ連携 |
| ドラッグ＆ドロップ | vuedraggable 4.x | SortableJS ベース、Vue 3 対応の Kanban ドラッグ |
| HTTP クライアント | Axios | インターセプター統一で JWT Token と CorrelationId を注入 |
| バックエンドランタイム | Node.js 20.x Lambda | フロントエンドと同言語、コールドスタート最適化 |
| データベース | DynamoDB 多テーブル | アクセスパターン別モデリング、MVP フェーズで明快 |
| 認証 | Cognito User Pools | マネージド JWT、運用負荷なし |
| ファイルストレージ | S3 プリサインド URL | Lambda の 6MB 制限を回避、クライアント直接アップロード |
| CDN | CloudFront | グローバル配信、HTTPS 強制、OAC で S3 保護 |

---

## AWS リソース構成（実際のリソース ID）

### Cognito
- **User Pool ID**: `us-east-1_PvLPf6TL0`
- **App Client ID**: `29taqubn8q5crh7jddgnelqc2q`
- **Region**: `us-east-1`
- **Hosted UI ドメイン**: `https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com`

### DynamoDB
- **Projects テーブル**: `TaskVista-Projects`
- **Tasks テーブル**: `TaskVista-Tasks`
- **Comments テーブル**: `TaskVista-Comments`
- **Region**: `us-east-1`

### S3
- **フロントエンドバケット**: `taskvista-frontend`
- **添付ファイルバケット**: `taskvista-attachments`

### IAM
- **Lambda 実行ロール ARN**: `arn:aws:iam::312310269639:role/TaskVista-Lambda-Execution-Role`

---

## システムコンポーネント設計

### 1. フロントエンドアーキテクチャ

```
src/
├── main.ts                  # アプリケーションエントリ、プラグイン登録
├── App.vue                  # ルートコンポーネント、ルーターアウトレット
├── router/
│   └── index.ts             # ルーティング設定、ナビゲーションガード（認証チェック）
├── stores/
│   ├── auth.ts              # Pinia: ユーザー認証状態、トークン管理
│   ├── projects.ts          # Pinia: Project CRUD、リストキャッシュ
│   ├── tasks.ts             # Pinia: Task CRUD、かんばん／テーブルデータ
│   └── ui.ts                # Pinia: グローバル UI 状態（スナックバー、ローディング）
├── api/
│   ├── client.ts            # Axios インスタンス、JWT + CorrelationId インターセプター
│   ├── projects.ts          # Projects API 呼び出し
│   ├── tasks.ts             # Tasks API 呼び出し
│   └── comments.ts          # Comments & Attachments API 呼び出し
├── views/
│   ├── LoginView.vue        # ログインページ（Cognito Hosted UI へリダイレクト）
│   ├── CallbackView.vue     # OAuth コールバック処理
│   ├── DashboardView.vue    # ダッシュボード、プロジェクト横断統計
│   ├── ProjectListView.vue  # プロジェクト一覧ページ
│   ├── TaskBoardView.vue    # かんばんビュー
│   └── TaskTableView.vue    # テーブルリストビュー
├── components/
│   ├── layout/
│   │   ├── AppNav.vue       # トップナビゲーションバー
│   │   └── AppSidebar.vue   # サイドバー（プロジェクトナビゲーション）
│   ├── project/
│   │   ├── ProjectCard.vue  # プロジェクトカード（ダッシュボード用）
│   │   └── ProjectForm.vue  # プロジェクト作成／編集フォーム
│   ├── task/
│   │   ├── TaskCard.vue     # かんばんタスクカード
│   │   ├── TaskDetail.vue   # タスク詳細パネル（サイドドロワー）
│   │   ├── TaskForm.vue     # タスク作成／編集フォーム
│   │   └── TaskFilters.vue  # ステータス／担当者／優先度フィルター
│   ├── comment/
│   │   └── CommentThread.vue # コメントリストと入力欄
│   └── common/
│       ├── ConfirmDialog.vue  # 汎用確認ダイアログ
│       └── SkeletonLoader.vue # スケルトンスクリーンコンポーネント
└── types/
    ├── project.ts           # Project 型定義
    ├── task.ts              # Task 型定義
    └── comment.ts           # Comment / Attachment 型定義
```

#### ルート構造

| パス | コンポーネント | 説明 |
|------|--------------|------|
| `/login` | LoginView | 未認証時のリダイレクト先 |
| `/callback` | CallbackView | Cognito OAuth コールバック処理 |
| `/` | DashboardView | 認証必須、デフォルトホーム |
| `/projects` | ProjectListView | プロジェクト一覧 |
| `/projects/:projectId/board` | TaskBoardView | かんばんビュー |
| `/projects/:projectId/table` | TaskTableView | テーブルリストビュー |

#### フロントエンド環境変数

```
VITE_API_BASE_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com
VITE_COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0
VITE_COGNITO_CLIENT_ID=29taqubn8q5crh7jddgnelqc2q
VITE_COGNITO_DOMAIN=https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com
VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback
```

#### Pinia Store データフロー

```
ユーザー操作（Vue Component）
    │
    ▼
Pinia Action（楽観的更新でローカル状態を即反映）
    │
    ▼
API 層（Axios + JWT インターセプター）
    │
    ▼
API Gateway → Lambda → DynamoDB
    │
    ▼
成功: サーバーデータで store を同期
失敗: 楽観的更新をロールバック + ui.ts でスナックバー表示
```

---

### 2. バックエンドアーキテクチャ

#### Lambda 関数グループ

| 関数名 | 担当ルート | DynamoDB 操作 |
|--------|-----------|--------------|
| `taskvista-projects` | `/projects/*` | `TaskVista-Projects` テーブル CRUD |
| `taskvista-tasks` | `/projects/{id}/tasks`, `/tasks/*` | `TaskVista-Tasks` テーブル CRUD |
| `taskvista-comments` | `/tasks/{id}/comments/*` | `TaskVista-Comments` テーブル CRUD |
| `taskvista-attachments` | `/tasks/{id}/attachments/*` | S3 プリサインド URL 生成、Tasks テーブル メタデータ更新 |

各 Lambda 関数内部のレイヤー構造：

```
Lambda Handler (handler.ts)
    │  パラメーター解析、CorrelationId 生成、エラーバウンダリ
    ▼
Service Layer (service.ts)
    │  ビジネスロジック、入力バリデーション、権限チェック
    ▼
Repository Layer (repository.ts)
    │  DynamoDB / S3 SDK 呼び出しをここに封じ込める
    ▼
AWS SDK v3 (@aws-sdk/client-dynamodb 等)
```

> **移行ポイント**: `repository.ts` の実装を差し替えるだけで Firestore / Cloud Storage へ移行可能。Service・Handler 層は変更不要。

#### Lambda 実行ロール

全 Lambda は既存ロール `arn:aws:iam::312310269639:role/TaskVista-Lambda-Execution-Role` を使用し、最小権限の原則に従って各テーブルへのアクセスを制限する。

#### 統一レスポンスフォーマット

成功レスポンス：
```json
{
  "data": { "..." : "..." },
  "meta": {
    "correlationId": "uuid-v4",
    "timestamp": "2026-07-07T00:00:00.000Z"
  }
}
```

エラーレスポンス：
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "入力値が正しくありません",
    "fields": { "title": "タイトルは必須項目です" }
  },
  "meta": {
    "correlationId": "uuid-v4",
    "timestamp": "2026-07-07T00:00:00.000Z"
  }
}
```

#### Lambda 環境変数

```
PROJECTS_TABLE=TaskVista-Projects
TASKS_TABLE=TaskVista-Tasks
COMMENTS_TABLE=TaskVista-Comments
ATTACHMENTS_BUCKET=taskvista-attachments
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0
```

---

## データモデル

### DynamoDB 多テーブル設計

#### TaskVista-Projects テーブル

| 属性 | 型 | キー | 説明 |
|------|------|-----|------|
| `projectId` | String | PK | UUID v4 |
| `name` | String | | 1〜100 文字 |
| `description` | String | | 任意、最大 1000 文字 |
| `status` | String | | `active` \| `archived` |
| `createdBy` | String | GSI PK | Cognito sub（ユーザー固有 ID） |
| `memberIds` | StringSet | | プロジェクトメンバーの Cognito sub リスト |
| `createdAt` | String | | ISO 8601 |
| `updatedAt` | String | | ISO 8601 |
| `isDeleted` | Boolean | | 論理削除フラグ（デフォルト false） |

GSI: `CreatedByIndex`（PK: `createdBy`、SK: `createdAt`）

#### TaskVista-Tasks テーブル

| 属性 | 型 | キー | 説明 |
|------|------|-----|------|
| `taskId` | String | PK | UUID v4 |
| `projectId` | String | GSI PK | 関連プロジェクト |
| `title` | String | | 1〜200 文字 |
| `description` | String | | 任意、最大 5000 文字 |
| `status` | String | GSI SK | 「未着手」\|「進行中」\|「レビュー待ち」\|「完了」\|「保留」 |
| `priority` | String | | `low` \| `medium` \| `high` \| `urgent` |
| `location` | String | | 場所フィールド（任意） |
| `requirement` | String | | 要望フィールド（任意） |
| `assigneeId` | String | | Cognito sub（任意） |
| `dueDate` | String | | ISO 8601 日付（任意） |
| `attachments` | List | | 添付ファイルメタデータリスト |
| `createdBy` | String | | Cognito sub |
| `createdAt` | String | | ISO 8601 |
| `updatedAt` | String | | ISO 8601 |
| `isDeleted` | Boolean | | 論理削除フラグ（デフォルト false） |

GSI: `ProjectStatusIndex`（PK: `projectId`、SK: `status`）  
GSI: `AssigneeIndex`（PK: `assigneeId`、SK: `dueDate`）

添付ファイルメタデータ（`attachments` List 内にネスト）：
```json
{
  "attachmentId": "uuid-v4",
  "filename": "screenshot.png",
  "s3Key": "tasks/{taskId}/{attachmentId}-screenshot.png",
  "contentType": "image/png",
  "sizeBytes": 204800,
  "uploadedBy": "cognito-sub",
  "uploadedAt": "2026-07-07T00:00:00.000Z"
}
```

#### TaskVista-Comments テーブル

| 属性 | 型 | キー | 説明 |
|------|------|-----|------|
| `commentId` | String | PK | UUID v4 |
| `taskId` | String | GSI PK | 関連タスク |
| `content` | String | | 1〜2000 文字 |
| `authorId` | String | | Cognito sub |
| `authorName` | String | | 冗長保存（Cognito 照会を回避） |
| `createdAt` | String | GSI SK | ISO 8601（ソート用） |
| `updatedAt` | String | | ISO 8601 |

GSI: `TaskCommentsIndex`（PK: `taskId`、SK: `createdAt`）

---

## API 設計

すべてのエンドポイントに `Authorization: Bearer <JWT>` ヘッダーが必要。

### Projects API

| メソッド | パス | 説明 | 成功ステータス |
|---------|------|------|--------------|
| GET | `/projects` | 現在のユーザーのプロジェクト一覧取得 | 200 |
| POST | `/projects` | 新規プロジェクト作成 | 201 |
| GET | `/projects/{projectId}` | プロジェクト詳細取得 | 200 |
| PUT | `/projects/{projectId}` | プロジェクト情報更新 | 200 |
| DELETE | `/projects/{projectId}` | プロジェクト論理削除 | 200 |

### Tasks API

| メソッド | パス | 説明 | 成功ステータス |
|---------|------|------|--------------|
| GET | `/projects/{projectId}/tasks` | プロジェクト内タスク一覧取得 | 200 |
| POST | `/projects/{projectId}/tasks` | プロジェクト内タスク作成 | 201 |
| GET | `/tasks/{taskId}` | タスク詳細取得 | 200 |
| PUT | `/tasks/{taskId}` | タスク更新（ステータス変更を含む） | 200 |
| PATCH | `/tasks/{taskId}/status` | ステータスのみ更新（かんばんドラッグ専用） | 200 |
| DELETE | `/tasks/{taskId}` | タスク論理削除 | 200 |

### Comments API

| メソッド | パス | 説明 | 成功ステータス |
|---------|------|------|--------------|
| GET | `/tasks/{taskId}/comments` | タスクのコメント一覧取得 | 200 |
| POST | `/tasks/{taskId}/comments` | コメント作成 | 201 |
| DELETE | `/tasks/{taskId}/comments/{commentId}` | コメント削除（作成者のみ） | 200 |

### Attachments API

| メソッド | パス | 説明 | 成功ステータス |
|---------|------|------|--------------|
| GET | `/tasks/{taskId}/attachments` | 添付ファイル一覧取得 | 200 |
| POST | `/tasks/{taskId}/attachments/upload-url` | アップロード用プリサインド PUT URL 取得 | 200 |
| GET | `/tasks/{taskId}/attachments/{attachmentId}/download-url` | ダウンロード用プリサインド GET URL 取得 | 200 |
| DELETE | `/tasks/{taskId}/attachments/{attachmentId}` | 添付ファイル削除 | 200 |

### Dashboard API

| メソッド | パス | 説明 | 成功ステータス |
|---------|------|------|--------------|
| GET | `/dashboard/summary` | プロジェクト横断統計取得 | 200 |
| GET | `/dashboard/my-tasks` | 現在のユーザーの担当タスク取得 | 200 |

---

## かんばんビュー設計

```
TaskBoardView.vue
├── TaskFilters.vue          # 担当者 / 優先度フィルター（クライアントサイド）
└── [ステータスごとの v-col]
    └── vuedraggable         # SortableJS によるクロスカラムドラッグ
        └── TaskCard.vue     # タイトル / 担当者 / 優先度 / 期日を表示
```

**ドラッグによるステータス更新フロー：**

1. `vuedraggable` が `@change` イベントを発火し、`taskId` と目的の `status` を渡す
2. Pinia `tasks` store がローカル状態を楽観的更新（即座にカードを移動）
3. `PATCH /tasks/{taskId}/status` を呼び出す
4. 成功時: サーバーレスポンスで store を同期（`updatedAt` を含む）
5. 失敗時: store のタスクステータスをロールバック、スナックバーでエラー表示

---

## テーブルビュー設計

```
TaskTableView.vue
├── TaskFilters.vue          # 複合フィルター（ステータス / 担当者 / 優先度）
├── v-text-field             # タイトルあいまい検索（300ms デバウンス）
└── v-data-table             # Vuetify 内蔵、ソート・ページング対応
    └── TaskDetail.vue       # 行クリックでサイドドロワー展開（v-navigation-drawer）
```

`v-data-table` カラム定義（`headers`）：

| key | ヘッダー表示 | ソート可 |
|-----|------------|---------|
| `location` | 場所 | ○ |
| `requirement` | 要望 | × |
| `status` | ステータス | ○ |
| `assigneeId` | 担当者 | ○ |
| `priority` | 優先度 | ○ |
| `dueDate` | 期日 | ○ |
| `createdAt` | 作成日 | ○ |

---

## 認証フロー

```
1. ユーザーが任意のルートにアクセス
2. Vue Router ナビゲーションガードが Pinia auth store の有効なトークンを確認
3. トークンなし → /login にリダイレクト
4. /login → Cognito Hosted UI にリダイレクト（OAuth 2.0 Authorization Code Flow）
   ベース URL: https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com
   クライアント ID: 29taqubn8q5crh7jddgnelqc2q
5. ユーザーがログイン成功 → Cognito が /callback?code=xxx にリダイレクト
6. フロントエンドが code でアクセストークン / ID トークン / リフレッシュトークンを取得
7. トークンを memory（アクセス/ID）+ localStorage（リフレッシュ）に保存
8. Axios インターセプターが各リクエストヘッダーに Bearer トークンを自動注入
9. トークン失効（401 レスポンス）→ リフレッシュトークンで新しいトークンを取得 → リクエストをリトライ
10. リフレッシュトークン失効 → store をクリア → /login にリダイレクト
```

---

## セキュリティ設計

| 制御ポイント | 対策 |
|------------|------|
| API 認証 | API Gateway Cognito Authorizer で JWT 署名を検証 |
| リソース認可 | Lambda Service 層で `projectId` がユーザーの `memberIds` に含まれるか確認 |
| 入力バリデーション | Lambda が `zod` ライブラリでリクエストボディを Schema 検証 |
| S3 アクセス | プリサインド URL 経由のみ、バケットは非公開。フロントエンドバケットは CloudFront OAC のみ許可 |
| IAM 権限 | 既存ロール `TaskVista-Lambda-Execution-Role` を使用、テーブル名と操作種別を精確に指定 |
| ログセキュリティ | CloudWatch ログにトークン・パスワード・S3 プリサインド URL を記録しない |
| HTTPS 強制 | CloudFront で HTTPS 強制、HTTP リクエストは 301 リダイレクト |
| パスワードポリシー | Cognito で 8 文字以上、大小英字・数字を含む複雑性を要求 |

---

## 可観測性設計

各 Lambda 呼び出しが構造化 JSON ログを出力：

```json
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "aws-lambda-request-id",
  "level": "INFO",
  "message": "タスクのステータスを更新しました",
  "timestamp": "2026-07-07T10:00:00.000Z",
  "duration": 145,
  "userId": "cognito-sub",
  "resourceId": "task-uuid",
  "action": "UPDATE_TASK_STATUS"
}
```

CloudWatch アラーム設定推奨：
- Lambda エラー率 > 1% で SNS 通知
- Lambda P95 レイテンシ > 3000ms で WARN ログ
- DynamoDB 読み書きキャパシティが閾値超過でアラーム

---

## デプロイアーキテクチャ

### インフラリソース一覧（AWS 既存リソース）

| リソース | 設定ポイント |
|---------|------------|
| S3: `taskvista-frontend` | 静的ホスティング、Block Public Access、OAC ポリシー |
| S3: `taskvista-attachments` | Block Public Access、ライフサイクルルール（365 日後 Glacier へ移行） |
| CloudFront | HTTPS Only、カスタムエラーページ（403/404 → /index.html）、OAC |
| API Gateway | HTTP API、Cognito JWT Authorizer、CORS 設定 |
| Lambda × 4 | Node.js 20.x、メモリ 256MB、タイムアウト 30s、既存 IAM ロール使用 |
| DynamoDB × 3 | PAY_PER_REQUEST、Point-in-Time Recovery 有効 |
| Cognito | User Pool: `us-east-1_PvLPf6TL0`、App Client: `29taqubn8q5crh7jddgnelqc2q` |
| CloudWatch | Log Groups、メトリクスフィルター、ダッシュボード |

> **重要**: 新しい AWS リソースは作成しない。上記の既存リソースをすべて使用すること。

---

## Google Cloud 移行パス

| 置き換え対象 | AWS 側 | GCP 側 |
|------------|--------|--------|
| DB Repository | `@aws-sdk/client-dynamodb` | `@google-cloud/firestore` |
| ストレージ Repository | `@aws-sdk/client-s3` | `@google-cloud/storage` |
| 認証 | Cognito JWT | Firebase Auth / Identity Platform JWT |
| ランタイム | AWS Lambda | Cloud Run（Node.js コンテナ） |
| CDN | CloudFront + S3 | Cloud CDN + Cloud Storage |
| API エントリ | API Gateway | Cloud Endpoints / Cloud Run URL |

フロントエンドは `VITE_API_BASE_URL` を変更するだけ。Vue コンポーネント・Pinia stores・ビジネスロジックの変更は不要。
