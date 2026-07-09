# 実装タスク一覧

## 説明

本ファイルはフェーズ（Phase）別に実装タスクを整理したもの。各タスクは独立して完了・検証できる単位とする。  
優先順位：基盤整備 → バックエンドコア API → フロントエンドコア機能 → 応用機能。

**重要**: すべてのコードコメントは自然な日本語で記述し、UI テキスト（ボタン、タイトル、ラベル、メッセージ）はすべて日本語とする。

---

## Phase 1：プロジェクト初期化と基盤整備

### タスク 1.1：フロントエンドプロジェクト初期化

- `npm create vue@latest` で Vue 3 + TypeScript プロジェクトを作成（プロジェクト名: `src`）
- 依存パッケージをインストール: `vuetify@^3.7`, `pinia@^2`, `vue-router@^4`, `axios@^1`, `vuedraggable@^4`
- 開発依存: `vite-plugin-vuetify`, `@mdi/font`, `sass`
- Vuetify テーマを設定（primary: インディゴ系、secondary: アンバー系）
- ESLint + Prettier を設定、`.editorconfig` を追加
- `src/` ディレクトリ構造を作成: `views/`, `components/`, `stores/`, `api/`, `types/`, `router/`
- Vite 環境変数を設定:
  - `VITE_API_BASE_URL`
  - `VITE_COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0`
  - `VITE_COGNITO_CLIENT_ID=29taqubn8q5crh7jddgnelqc2q`
  - `VITE_COGNITO_DOMAIN=https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com`
  - `VITE_COGNITO_REDIRECT_URI=http://localhost:5173/callback`
- 検収: `npm run dev` が正常起動し、Vuetify コンポーネントが描画される

### タスク 1.2：バックエンドプロジェクト構造の初期化

- `backend/` ディレクトリに Node.js + TypeScript プロジェクトを作成
- 依存パッケージをインストール（バージョン固定）:
  - `@aws-sdk/client-dynamodb@^3`
  - `@aws-sdk/lib-dynamodb@^3`
  - `@aws-sdk/client-s3@^3`
  - `@aws-sdk/s3-request-presigner@^3`
  - `zod@^3`
  - `uuid@^9`
  - `@types/uuid@^9`（開発依存）
- 各 Lambda のディレクトリ構造を作成:
  - `backend/src/projects/` — `handler.ts`, `service.ts`, `repository.ts`
  - `backend/src/tasks/` — `handler.ts`, `service.ts`, `repository.ts`
  - `backend/src/comments/` — `handler.ts`, `service.ts`, `repository.ts`
  - `backend/src/attachments/` — `handler.ts`, `service.ts`, `repository.ts`
- 共有モジュールを作成:
  - `backend/src/shared/logger.ts` — 構造化 JSON ログ（correlationId 付き）
  - `backend/src/shared/response.ts` — 統一レスポンスフォーマット
  - `backend/src/shared/errors.ts` — カスタムエラークラス
- `tsconfig.json`（strict モード）とビルドスクリプトを設定
- Lambda 環境変数:
  - `PROJECTS_TABLE=TaskVista-Projects`
  - `TASKS_TABLE=TaskVista-Tasks`
  - `COMMENTS_TABLE=TaskVista-Comments`
  - `ATTACHMENTS_BUCKET=taskvista-attachments`
  - `AWS_REGION=us-east-1`
  - `COGNITO_USER_POOL_ID=us-east-1_PvLPf6TL0`
- 検収: `tsc --noEmit` でコンパイルエラーなし

### タスク 1.3：DynamoDB テーブル確認と GSI 設定

- 既存テーブルの設定を確認（新規作成不要）:
  - `TaskVista-Projects`: PK `projectId`、GSI `CreatedByIndex`（PK: `createdBy`, SK: `createdAt`）
  - `TaskVista-Tasks`: PK `taskId`、GSI `ProjectStatusIndex`（PK: `projectId`, SK: `status`）、GSI `AssigneeIndex`（PK: `assigneeId`, SK: `dueDate`）
  - `TaskVista-Comments`: PK `commentId`、GSI `TaskCommentsIndex`（PK: `taskId`, SK: `createdAt`）
- 各テーブルが PAY_PER_REQUEST モードで、Point-in-Time Recovery が有効か確認
- 検収: AWS コンソールで 3 テーブルが ACTIVE 状態、GSI 設定が正確であることを確認

### タスク 1.4：Cognito 設定確認

- 既存リソースを使用（新規作成不要）:
  - User Pool ID: `us-east-1_PvLPf6TL0`
  - App Client ID: `29taqubn8q5crh7jddgnelqc2q`
  - Hosted UI: `https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com`
- コールバック URL の設定を確認: ローカル `http://localhost:5173/callback`、本番 CloudFront ドメイン `/callback`
- 検収: Hosted UI からログインできること、有効な JWT トークンが取得できること

---

## Phase 2：バックエンドコア API 実装

### タスク 2.1：Lambda 共通モジュール実装

- `shared/logger.ts`: CorrelationId を含む構造化 JSON ログ出力（INFO / WARN / ERROR レベル）
- `shared/errors.ts`: カスタムエラークラス（`ValidationError`、`NotFoundError`、`ForbiddenError`）
- `shared/response.ts`: 統一レスポンスビルダー（成功・エラーフォーマット、HTTP ステータスコード設定）
- 検収: 各モジュールの単体動作確認、ログ出力フォーマットが仕様通りであること

### タスク 2.2：Projects Lambda 実装（CRUD）

- `repository.ts`: DynamoDB の `PutItem`、`GetItem`、`Query`（CreatedByIndex GSI）、`UpdateItem` をラップ
  - テーブル名は環境変数 `PROJECTS_TABLE`（= `TaskVista-Projects`）から取得
- `service.ts`: `zod` でリクエストボディを検証、論理削除ロジック（`isDeleted: true`）、権限チェック（`createdBy` または `memberIds` に現在ユーザーが含まれるか）
- `handler.ts`: ルーティング（GET/POST `/projects`、GET/PUT/DELETE `/projects/{projectId}`）、CorrelationId 生成、統一レスポンス整形
- 構造化ログ出力: `correlationId`、`duration`、`action` フィールドを含む
- 検収: Postman で 5 エンドポイントを正常系・異常系（400/403/404）で完全テスト

### タスク 2.3：Tasks Lambda 実装（CRUD + ステータス更新）

- `repository.ts`: Tasks テーブル CRUD、`ProjectStatusIndex` GSI でプロジェクト別クエリ
  - テーブル名は環境変数 `TASKS_TABLE`（= `TaskVista-Tasks`）から取得
- `service.ts`: `status` 列挙値を検証（「未着手」「進行中」「レビュー待ち」「完了」「保留」）、`assigneeId` 形式を検証、論理削除実装
- `handler.ts`: 6 ルートを実装。特に `PATCH /tasks/{taskId}/status`（かんばんドラッグ専用）を専用ハンドラーとして実装
- 検収: 6 エンドポイントを完全テスト、無効な status 列挙値で 400 が返り許可値リストが含まれること

### タスク 2.4：Comments Lambda 実装（CRUD）

- `repository.ts`: Comments テーブル CRUD、`TaskCommentsIndex` GSI で `taskId` 別クエリ（`createdAt` 昇順）
  - テーブル名は環境変数 `COMMENTS_TABLE`（= `TaskVista-Comments`）から取得
- `service.ts`: コメント内容の長さを検証（1〜2000 文字）、削除時は `authorId` と現在ユーザーの一致を確認（不一致は 403）
- `handler.ts`: 3 ルートを実装（GET/POST `/tasks/{taskId}/comments`、DELETE `.../comments/{commentId}`）
- 検収: 3 エンドポイントを完全テスト、非作成者が削除しようとすると 403 が返ること

### タスク 2.5：Attachments Lambda 実装（プリサインド URL）

- `repository.ts`:
  - S3 プリサインド PUT URL 生成（有効期限 15 分）: バケット `taskvista-attachments`
  - S3 プリサインド GET URL 生成（有効期限 60 分）
  - `DeleteObject` 呼び出し
  - Tasks テーブルの `attachments` リスト更新
- `service.ts`: ファイルサイズ 50MB 上限を検証、S3 キー形式を生成（`tasks/{taskId}/{attachmentId}-{filename}`）
- `handler.ts`: 4 エンドポイントを実装（一覧取得、アップロード URL、ダウンロード URL、削除）
- 検収: フロントエンドからプリサインド URL 経由で S3 へ直接アップロードでき、50MB 超は 400 が返ること

### タスク 2.6：Dashboard Lambda 実装（集計統計）

- `GET /dashboard/summary`: ユーザーの全プロジェクトを取得し、`Promise.all` で各プロジェクトのタスクステータス統計を並列クエリ
- `GET /dashboard/my-tasks`: `AssigneeIndex` GSI をクエリ、未完了タスクを絞り込み、`dueDate` 昇順でソート
- 検収: 各プロジェクトのステータス別タスク数が返り、レスポンスタイムが 3000ms 未満であること

---

## Phase 3：フロントエンドコア機能実装

### タスク 3.1：型定義ファイルの作成

- `src/types/project.ts`: `Project`、`CreateProjectPayload`、`UpdateProjectPayload` インターフェース
- `src/types/task.ts`: `Task`、`TaskStatus`（列挙型）、`TaskPriority`（列挙型）、`CreateTaskPayload`、`UpdateTaskPayload` インターフェース
  - ステータス値: `未着手 | 進行中 | レビュー待ち | 完了 | 保留`
- `src/types/comment.ts`: `Comment`、`Attachment`、`CreateCommentPayload` インターフェース

### タスク 3.2：認証フローの実装

- `src/stores/auth.ts`: アクセストークン（memory）、リフレッシュトークン（localStorage）を管理
  - `isAuthenticated`、`currentUser`、`login()`、`logout()`、`refreshToken()` を公開
  - Cognito Hosted UI URL を構築: ベース `https://us-east-1pvlpf6tl0.auth.us-east-1.amazoncognito.com`
  - クライアント ID: `29taqubn8q5crh7jddgnelqc2q`
- `src/api/client.ts`: Axios インスタンス
  - リクエストインターセプター: `Authorization: Bearer <token>` と `X-Correlation-Id` を注入
  - レスポンスインターセプター: 401 を捕捉し、リフレッシュトークンでトークンを更新してリトライ
- `src/router/index.ts`: `beforeEach` ナビゲーションガードで未認証を `/login` にリダイレクト
  - `/callback` ルートで Cognito コールバック処理（認証コードをトークンに交換）
- `src/views/LoginView.vue`: ログインページ。ボタンクリックで Cognito Hosted UI（OAuth 2.0 Authorization Code Flow）にリダイレクト
  - UI テキスト例: 「TaskVista にログインする」「Cognito でサインイン」
- `src/views/CallbackView.vue`: コールバック処理、ローディング表示後にダッシュボードへリダイレクト
- 検収: ログイン → コールバックでトークン取得 → ホームへ遷移 → トークン失効で自動リフレッシュ → ログアウトで状態クリア

### タスク 3.3：API 呼び出し層の作成

- `src/api/projects.ts`: Projects API の 5 関数（`fetchProjects`, `fetchProject`, `createProject`, `updateProject`, `deleteProject`）
- `src/api/tasks.ts`: Tasks API の 6 関数（`fetchTasks`, `fetchTask`, `createTask`, `updateTask`, `updateTaskStatus`, `deleteTask`）
- `src/api/comments.ts`: Comments API の 3 関数（`fetchComments`, `createComment`, `deleteComment`）
- `src/api/attachments.ts`: Attachments API の 4 関数（`fetchAttachments`, `getUploadUrl`, `getDownloadUrl`, `deleteAttachment`）
- すべての関数で `VITE_API_BASE_URL` を使用、レスポンスは `ApiResponse<T>` 型でラップ

### タスク 3.4：Pinia ストアの作成

- `src/stores/ui.ts`:
  - スナックバー管理（メッセージ、色、表示/非表示）
  - グローバルローディング状態
  - `showSuccess(msg)`, `showError(msg)`, `showInfo(msg)` アクション
- `src/stores/projects.ts`:
  - `fetchProjects()`, `createProject()`, `updateProject()`, `deleteProject()` アクション
  - エラー時は ui store のスナックバーを発火
  - 例: 成功メッセージ「プロジェクトを作成しました」、エラー「プロジェクトの読み込みに失敗しました」
- `src/stores/tasks.ts`:
  - `tasksByStatus` computed（ステータス別グループ化）
  - `fetchTasks()`, `createTask()`, `updateTask()`, `updateTaskStatus()`, `deleteTask()` アクション
  - `updateTaskStatus()` は楽観的更新とロールバックロジックを実装
  - 例: エラーメッセージ「ステータスの更新に失敗しました。元に戻します」

### タスク 3.5：レイアウトコンポーネントの作成

- `src/components/layout/AppNav.vue`:
  - Vuetify `v-app-bar` でトップナビゲーション
  - ロゴ、プロジェクト名、ユーザーアバター（メニュー: 「設定」「ログアウト」）
  - ビュー切り替えタブ（「かんばん」「テーブル」）
- `src/App.vue`: `v-app` ルートコンポーネント、`AppNav` を組み込み、`router-view` でページ描画

### タスク 3.6：プロジェクト管理機能の実装

- `src/views/ProjectListView.vue`:
  - `v-card` グリッドでプロジェクト一覧表示
  - 「新しいプロジェクトを作成する」ボタン（`v-btn`）
  - 空状態: 「プロジェクトがまだありません。最初のプロジェクトを作成しましょう。」
  - ローディング中は `v-skeleton-loader` を表示
- `src/components/project/ProjectForm.vue`:
  - `v-dialog` 内のフォーム（作成・編集共用）
  - フィールド: プロジェクト名（必須）、説明（任意）、ステータス
  - 保存ボタン: 「保存する」、キャンセルボタン: 「キャンセル」
  - バリデーション: 名前が空の場合「プロジェクト名は必須項目です」
  - `defineProps<{ modelValue: boolean, project?: Project }>()` + `defineEmits(['update:modelValue', 'saved'])`

### タスク 3.7：かんばんビューの実装

- `src/views/TaskBoardView.vue`:
  - 5 ステータスカラム（「未着手」「進行中」「レビュー待ち」「完了」「保留」）
  - 各カラムに `vuedraggable` を使用、`@change` イベントでステータス更新
  - ローディング中は `v-skeleton-loader` を表示
  - 「新しいタスクを追加する」ボタン（各カラムヘッダー）
- `src/components/task/TaskCard.vue`:
  - Vuetify `v-card` でタスクカード
  - 表示内容: タイトル、担当者名/アバター、優先度 `v-chip`（色分け）、期日
  - クリックでタスク詳細を開く
- `src/components/task/TaskFilters.vue`:
  - 担当者と優先度の `v-select` フィルター
  - フィルタリングは `computed` でクライアントサイド処理

### タスク 3.8：テーブルビューの実装

- `src/views/TaskTableView.vue`:
  - `v-data-table` でタスク一覧（ヘッダー: 場所・要望・ステータス・担当者・優先度・期日・作成日）
  - `TaskFilters.vue` で複合フィルター（ステータス/担当者/優先度）
  - タイトルあいまい検索: `v-text-field` + 300ms デバウンス
  - ページング: デフォルト 20 件、ユーザーが 10/20/50 を選択可能
  - 行クリックで `v-navigation-drawer` を開き、`TaskDetail.vue` を表示
  - プレースホルダー: 「タスクを検索する」

### タスク 3.9：タスク詳細・コメント機能の実装

- `src/components/task/TaskDetail.vue`:
  - すべてのタスクフィールドを表示（タイトル、説明、ステータス、場所、要望、担当者、優先度、期日、作成者、作成日、最終更新日）
  - 「編集する」ボタン → `TaskForm.vue` をダイアログで表示
  - `CommentThread.vue` を埋め込み
- `src/components/task/TaskForm.vue`:
  - 完全なタスク編集フォーム（ステータス/優先度 `v-select`、日付ピッカー、担当者入力）
  - 保存ボタン: 「保存する」、キャンセルボタン: 「キャンセル」
  - ステータス選択肢: 「未着手」「進行中」「レビュー待ち」「完了」「保留」
  - 優先度選択肢: 「低」「中」「高」「緊急」
- `src/stores/comments.ts`: コメント CRUD アクション
- `src/components/comment/CommentThread.vue`:
  - 時刻昇順のコメントリスト
  - 現在ユーザーのコメントに削除ボタン（「削除する」）を表示
  - 入力欄プレースホルダー: 「コメントを入力してください」
  - 送信ボタン: 「コメントを送信する」

### タスク 3.10：ダッシュボードページの実装

- `src/views/DashboardView.vue`:
  - `/dashboard/summary` と `/dashboard/my-tasks` を並列呼び出し
  - プロジェクト概要カード（`ProjectCard.vue`）: プロジェクト名、総タスク数、ステータス別件数の `v-progress-linear`
  - 「自分の担当タスク」リスト（`v-list`）: タイトル、プロジェクト名、期日、期日昇順ソート
  - Vuetify `v-sparkline` でステータス分布を可視化
  - ローディング中は `v-progress-circular` を表示
  - セクションタイトル: 「プロジェクト概要」「自分の担当タスク」

---

## Phase 4：応用機能

### タスク 4.1：添付ファイルアップロードとダウンロードの実装

- `src/components/task/TaskDetail.vue` に添付ファイルセクションを追加:
  - `v-file-input` でファイル選択 → プリサインド PUT URL を取得 → `axios.put()` で S3 に直接アップロード → 一覧を更新
  - ダウンロード: ファイル名クリック → プリサインド GET URL を取得 → `window.open(url)` でブラウザダウンロード
- フロントエンドバリデーション: 50MB 超の場合「ファイルサイズが上限（50MB）を超えています」を表示、アップロードリクエストを中断
- 検収: 50MB 未満のファイルをアップロードし、S3 から直接ダウンロードできること。大容量ファイルはフロントエンドで遮断されること

### タスク 4.2：フロントエンドの CloudFront + S3 デプロイ設定

- `vite.config.ts` のビルド設定を確認（出力先: `dist/`）
- デプロイスクリプト作成:
  - `npm run build` で静的ファイルをビルド
  - `aws s3 sync dist/ s3://taskvista-frontend --delete` でバケットに同期
  - CloudFront キャッシュの無効化
- `.env.production` に本番用環境変数を設定
- 検収: CloudFront 経由で HTTPS アクセスができ、Vue Router のヒストリーモードが正常に動作すること

---

## 実装上の注意事項

### コーディング規約
- コードコメントはすべて**自然な日本語**で記述する
- UI テキスト（ボタン、ラベル、エラーメッセージ、プレースホルダー）はすべて**日本語**とする
- 変数名・関数名は英語の camelCase を維持する
- エラーメッセージ例: 「データの読み込みに失敗しました」「入力内容をご確認ください」「操作を完了しました」

### AWS リソース使用規則
- **新しい AWS リソースは作成しない**
- 使用するリソース:
  - Cognito User Pool: `us-east-1_PvLPf6TL0` / App Client: `29taqubn8q5crh7jddgnelqc2q`
  - DynamoDB: `TaskVista-Projects`, `TaskVista-Tasks`, `TaskVista-Comments`
  - S3: `taskvista-frontend`, `taskvista-attachments`
  - IAM ロール: `arn:aws:iam::312310269639:role/TaskVista-Lambda-Execution-Role`

### タスクステータス値（日本語固定）
| コード | 表示 |
|--------|------|
| `未着手` | 未着手 |
| `進行中` | 進行中 |
| `レビュー待ち` | レビュー待ち |
| `完了` | 完了 |
| `保留` | 保留 |

### 優先度値
| コード | 表示 |
|--------|------|
| `low` | 低 |
| `medium` | 中 |
| `high` | 高 |
| `urgent` | 緊急 |
