# 要件ドキュメント

## はじめに

TaskVista は、小規模開発チーム（5〜15 人）向けのタスク・プロジェクト進捗管理 Web アプリケーションである。Google Sheets による開発・レビュータスク管理の置き換えを目的とする。Kanban ボードと Table リストの二系統ビューを提供し、Project と Task のライフサイクル全体を管理する。アーキテクチャは AWS Serverless を採用し、フロントエンドは Vue 3 + Vuetify 3、将来の Google Cloud への移行も見据える。

---

## 用語集

- **System**：TaskVista システム全体。フロントエンドとバックエンドの全コンポーネントを含む
- **Frontend**：Vue 3 + Vuetify 3 のシングルページアプリケーション。`VITE_API_BASE_URL` によりバックエンドと疎結合
- **API_Gateway**：Amazon API Gateway HTTP API。RESTful リクエストのルーティングを担当
- **Lambda**：AWS Lambda 関数（Node.js）。ビジネスロジックを実装
- **DynamoDB**：Amazon DynamoDB。Projects、Tasks、Comments データを保存
- **S3**：Amazon S3。フロントエンド静的リソースとタスク添付を保存
- **CloudFront**：Amazon CloudFront CDN。フロントエンド静的リソースを配信
- **Cognito**：Amazon Cognito User Pools。ユーザー認証・認可を担当
- **CloudWatch**：Amazon CloudWatch。構造化ログと監視メトリクスを収集
- **Project**：プロジェクトエンティティ。名称、説明、ステータス、作成者、メンバー一覧などの属性を持つ
- **Task**：タスクエンティティ。ある Project に属し、タイトル、説明、ステータス、場所、要望、Assignee、優先度、期日などの属性を持つ
- **Comment**：コメントエンティティ。ある Task に属し、内容、投稿者、作成日時などの属性を持つ
- **Attachment**：添付エンティティ。ある Task に属し、S3 の `tasks/{taskId}/` 配下に保存される
- **User**：Cognito で認証されたチームメンバー
- **Assignee**：ある Task の担当に割り当てられた User
- **KanbanView**：Kanban ボードビュー。タスクステータスごとに列表示し、ドラッグでステータス変更可能
- **TableView**：テーブルリストビュー。行・列形式で Task を表示し、ソート・フィルター・ページングに対応
- **Dashboard**：概要ページ。Project 横断のタスク統計と進捗サマリーを表示
- **CorrelationId**：各 Lambda 呼び出しで生成される一意 ID。ログの関連付けに使用

---

## 要件

### 要件 1：ユーザー認証と認可

**ユーザーストーリー：** チームメンバーとして、安全なログインで TaskVista にアクセスし、認可されたユーザーだけがチームデータを閲覧・操作できるようにしたい。

#### 受入基準

1. WHEN ユーザーが未ログインのまま TaskVista にアクセスしたとき、THE Frontend SHALL ユーザーを Cognito ログインページへリダイレクトする。
2. WHEN ユーザーが有効なユーザー名・パスワードを送信したとき、THE Cognito SHALL JWT Access Token と ID Token を返す。
3. WHEN ユーザーが無効なユーザー名・パスワードを送信したとき、THE Cognito SHALL 認証失敗エラーを返し、THE Frontend SHALL 「ユーザー名またはパスワードが正しくありません」と表示する。
4. WHEN ユーザーの JWT Token が期限切れになったとき、THE Frontend SHALL Refresh Token で自動更新し、失敗時はログインページへリダイレクトする。
5. WHEN 認証済みユーザーが API をリクエストしたとき、THE API_Gateway SHALL JWT の署名と有効期限を検証し、無効なリクエストを拒否して HTTP 401 を返す。
6. WHEN 認証済みユーザーがログアウトしたとき、THE Frontend SHALL ローカルの Token を破棄し、ログインページへリダイレクトする。
7. THE Cognito SHALL 少なくとも 15 の同時ユーザーセッションをサポートする。

---

### 要件 2：Project 管理（CRUD）

**ユーザーストーリー：** プロジェクト責任者として、プロジェクトの作成・閲覧・編集・削除を行い、Google Sheets を手コピーせずに新プロジェクトを素早く始めたい。

#### 受入基準

1. WHEN 認証済みユーザーが有効な名称（1〜100 文字）でプロジェクト作成をリクエストしたとき、THE Lambda SHALL DynamoDB Projects テーブルにレコードを作成し、HTTP 201 と新規プロジェクトの完全な JSON（projectId、name、description、status、createdBy、createdAt、updatedAt を含む）を返す。
2. WHEN 認証済みユーザーがプロジェクト一覧をリクエストしたとき、THE Lambda SHALL DynamoDB から当該ユーザーがアクセス可能な全プロジェクトを照会し、2000ms 以内に返す。
3. WHEN 認証済みユーザーが特定 projectId の詳細をリクエストしたとき、THE Lambda SHALL DynamoDB から照会し完全なデータを返す。
4. IF リクエストされた projectId が DynamoDB に存在しない場合、THEN THE Lambda SHALL HTTP 404 と説明的なエラーメッセージを返す。
5. WHEN 認証済みユーザーがプロジェクト更新をリクエストしたとき、THE Lambda SHALL DynamoDB の該当レコードを更新し、updatedAt を更新して HTTP 200 と更新後データを返す。
6. WHEN 認証済みユーザーがプロジェクト削除をリクエストしたとき、THE Lambda SHALL DynamoDB 上で論理削除（ソフトデリート）し、HTTP 200 を返す。
7. IF 作成リクエストの名称が空、または 100 文字を超える場合、THEN THE Lambda SHALL HTTP 400 とフィールド単位の検証エラーを返す。
8. THE DynamoDB Projects テーブル SHALL projectId をパーティションキーとし、ユーザー別照会のため createdBy の GSI を維持する。

---

### 要件 3：Task 管理（CRUD）

**ユーザーストーリー：** チームメンバーとして、プロジェクト内でタスクの作成・閲覧・編集・削除を行い、各作業項目の進捗と担当を追跡したい。

#### 受入基準

1. WHEN 認証済みユーザーが有効なタイトル（1〜200 文字）と projectId でタスク作成をリクエストしたとき、THE Lambda SHALL DynamoDB Tasks テーブルにレコードを作成し、HTTP 201 と新規タスクの完全な JSON（taskId、projectId、title、description、status、assigneeId、priority、location、requirement、dueDate、createdBy、createdAt、updatedAt を含む）を返す。
2. WHEN 認証済みユーザーがある projectId 配下のタスク一覧をリクエストしたとき、THE Lambda SHALL DynamoDB から当該プロジェクトの全タスクを照会し、2000ms 以内に返す。
3. WHEN 認証済みユーザーが特定 taskId の詳細をリクエストしたとき、THE Lambda SHALL タスクの完全データと関連 Comment 件数を返す。
4. IF リクエストされた taskId が DynamoDB に存在しない場合、THEN THE Lambda SHALL HTTP 404 と説明的なエラーメッセージを返す。
5. WHEN 認証済みユーザーがタスク更新をリクエストしたとき、THE Lambda SHALL DynamoDB の該当レコードを更新し、updatedAt を更新して HTTP 200 と更新後データを返す。
6. WHEN 認証済みユーザーがタスクの assigneeId を更新したとき、THE Lambda SHALL 対応ユーザーが Cognito User Pool に存在するか検証し、存在しなければ HTTP 400 を返す。
7. WHEN 認証済みユーザーがタスク削除をリクエストしたとき、THE Lambda SHALL DynamoDB 上で論理削除し、HTTP 200 を返す。
8. THE DynamoDB Tasks テーブル SHALL taskId をパーティションキー、projectId を GSI パーティションキーとし、プロジェクト単位の効率的な照会を可能にする。
9. THE Lambda SHALL タスクステータスとして「未着手」「進行中」「レビュー待ち」「完了」「保留」のいずれかをサポートする。
10. IF タスクステータスが許可リスト外の場合、THEN THE Lambda SHALL HTTP 400 と許可値一覧を含むエラーメッセージを返す。

---

### 要件 4：Kanban ボードビュー

**ユーザーストーリー：** チームメンバーとして、Kanban ボードでタスクの状態分布を直感的に把握し、ドラッグで素早くステータスを変更したい。

#### 受入基準

1. WHEN ユーザーがある Project のボードページに入ったとき、THE Frontend SHALL タスクをステータス（「未着手」「進行中」「レビュー待ち」「完了」「保留」）ごとに列表示し、各列で Vuetify v-card によりタスクカードを描画する。
2. WHEN ユーザーがタスクカードをあるステータス列から別列へドラッグしたとき、THE Frontend SHALL vuedraggable で操作を処理し、API でステータスを更新し、レスポンス前に UI を楽観的更新する。
3. IF ステータス更新 API が失敗した場合、THEN THE Frontend SHALL カードをドラッグ前の列へロールバックし、エラーメッセージを表示する。
4. THE Frontend SHALL 各タスクカードにタイトル、Assignee のアバターまたは氏名、優先度、期日（存在する場合）を表示する。
5. WHILE Kanban データを読み込み中、THE Frontend SHALL スケルトンローダー（skeleton loader）を表示する。
6. THE Frontend SHALL Kanban ビューで Assignee または優先度によるカード絞り込みをサポートし、クライアント側で完結させ API 再リクエストを不要とする。

---

### 要件 5：Table リストビュー

**ユーザーストーリー：** プロジェクト責任者として、テーブルビューですべてのタスク詳細フィールドを閲覧し、ソート・フィルター・ページングで分析・フォローしたい。

#### 受入基準

1. WHEN ユーザーがある Project のテーブルページに入ったとき、THE Frontend SHALL Vuetify v-data-table でタスク一覧を表示し、既定列は場所（location）、要望（requirement）、ステータス（status）、Assignee、優先度、期日、作成日時とする。
2. THE Frontend SHALL 列見出しクリックによる昇順・降順ソートをサポートし、ソートはクライアント側で行う。
3. THE Frontend SHALL ステータス、Assignee、優先度の組み合わせによるフィルターをサポートし、クライアント側で行う。
4. THE Frontend SHALL ページングをサポートし、既定は 1 ページ 20 件、ユーザーは 10 / 20 / 50 件を選択できる。
5. WHEN ユーザーがテーブル行のタスクをクリックしたとき、THE Frontend SHALL Task 詳細サイドバーを開くか、Task 詳細ページへ遷移する。
6. THE Frontend SHALL 検索ボックスによるタイトルあいまい検索をサポートし、クライアント側で入力後 300ms 以内に結果を更新する。

---

### 要件 6：Task 詳細とコメント管理

**ユーザーストーリー：** チームメンバーとして、タスクの全詳細を確認しコメントを追加して、議論と決定を記録したい。

#### 受入基準

1. WHEN ユーザーが Task 詳細を開いたとき、THE Frontend SHALL すべてのフィールド（タイトル、説明、ステータス、場所、要望、Assignee、優先度、期日、作成者、作成日時、最終更新日時）とコメント一覧を表示する。
2. WHEN 認証済みユーザーが非空（1〜2000 文字）のコメントを投稿したとき、THE Lambda SHALL DynamoDB Comments テーブルにレコードを作成し、HTTP 201 と新コメントの完全な JSON（commentId、taskId、content、authorId、createdAt を含む）を返す。
3. WHEN ユーザーがある taskId のコメント一覧をリクエストしたとき、THE Lambda SHALL DynamoDB から全コメントを照会し、createdAt 昇順で返す。
4. IF コメント内容が空、または 2000 文字を超える場合、THEN THE Lambda SHALL HTTP 400 とフィールド単位の検証エラーを返す。
5. THE DynamoDB Comments テーブル SHALL commentId をパーティションキー、taskId を GSI パーティションキーとし、タスク単位のコメント照会を可能にする。
6. WHEN 認証済みユーザーがコメントの authorId であるとき、THE Frontend SHALL 削除ボタンを表示する。WHEN ユーザーが削除をクリックしたとき、THE Lambda SHALL DynamoDB から当該コメントをハード削除し、HTTP 200 を返す。

---

### 要件 7：添付ファイル管理

**ユーザーストーリー：** チームメンバーとして、タスクに添付をアップロード・ダウンロードし、関連ドキュメントやスクリーンショットを共有したい。

#### 受入基準

1. WHEN 認証済みユーザーが添付アップロードをリクエストしたとき、THE Lambda SHALL 有効期限 15 分の S3 プリサインド PUT URL を生成する。パス形式は `tasks/{taskId}/{attachmentId}-{filename}` とし、URL と添付メタデータを返す。
2. WHEN フロントエンドがプリサインド PUT URL を受け取ったとき、THE Frontend SHALL Lambda を経由せず S3 へ直接アップロードし、Lambda の 6MB ペイロード制限を回避する。
3. THE Lambda SHALL 単一添付の上限を 50MB とする。IF ファイルサイズが 50MB を超える場合、THEN THE Lambda SHALL HTTP 400 とサイズ制限の説明を返す。
4. WHEN 認証済みユーザーが添付ダウンロードをリクエストしたとき、THE Lambda SHALL 有効期限 60 分の S3 プリサインド GET URL を返し、THE Frontend SHALL その URL でブラウザダウンロードを開始する。
5. THE S3 添付バケット SHALL ライフサイクルルールを設定し、365 日以上未アクセスの添付を S3 Glacier Instant Retrieval へ移行する。
6. WHEN 認証済みユーザーが添付を削除したとき、THE Lambda SHALL DynamoDB 上の Task 添付メタデータからレコードを除去し、S3 DeleteObject でファイルを削除して HTTP 200 を返す。

---

### 要件 8：Dashboard とデータ統計

**ユーザーストーリー：** プロジェクト責任者として、Dashboard でプロジェクト横断のタスク統計と進捗サマリーを把握し、チーム全体の状況を素早く知りたい。

#### 受入基準

1. WHEN 認証済みユーザーが Dashboard にアクセスしたとき、THE Frontend SHALL アクセス可能な全 Project の要約一覧を表示する（プロジェクト名、総タスク数、ステータス別件数）。
2. THE Frontend SHALL 「自分の担当タスク」一覧を表示し、現在ユーザーが Assignee でステータスが「完了」でないタスクを期日昇順で並べる。
3. WHEN 認証済みユーザーが Dashboard 統計をリクエストしたとき、THE Lambda SHALL DynamoDB から集計し、3000ms 以内に結果を返す。
4. THE Frontend SHALL Dashboard にタスクステータス分布のチャート（Vuetify 内蔵コンポーネントまたは軽量チャート）を表示し、各ステータスの割合を示す。
5. WHILE Dashboard データを読み込み中、THE Frontend SHALL プログレスインジケーターを表示する。

---

### 要件 9：API 設計と可観測性

**ユーザーストーリー：** バックエンド開発者として、すべての API が RESTful に従い構造化ログを出力し、保守・障害調査と将来の Google Cloud 移行を容易にしたい。

#### 受入基準

1. THE API_Gateway SHALL すべての API エンドポイントで CORS を有効にし、CloudFront ドメインからのクロスオリジン要求を許可する。
2. THE Lambda SHALL 各呼び出しで一意の CorrelationId を生成し、すべての構造化 JSON ログに含める。
3. THE Lambda SHALL 構造化ログを CloudWatch に出力する。フィールドは correlationId、requestId、level、message、timestamp、duration（ms）を含む。
4. WHEN Lambda の実行時間が 5000ms を超えたとき、THE Lambda SHALL level が WARN のログを duration 付きで出力する。
5. IF Lambda で未捕捉例外が発生した場合、THEN THE Lambda SHALL HTTP 500 と一般的なエラーメッセージ（スタックは露出させない）を返し、詳細を CloudWatch に記録する。
6. THE API_Gateway SHALL RESTful リソースパス規約に従う：`/projects`、`/projects/{projectId}`、`/projects/{projectId}/tasks`、`/tasks/{taskId}`、`/tasks/{taskId}/comments`、`/tasks/{taskId}/attachments`。
7. THE System SHALL 標準 HTTP メソッド（GET、POST、PUT、PATCH、DELETE）とステータスコード（200、201、400、401、403、404、500）を使用し、Google Cloud Run 移行時にフロントエンド呼び出しを変更不要とする。

---

### 要件 10：フロントエンドデプロイと CDN 配信

**ユーザーストーリー：** 運用責任者として、フロントエンドを CloudFront + S3 でデプロイ・配信し、低コストかつ高可用なグローバルアクセスを実現したい。

#### 受入基準

1. THE Frontend SHALL 静的リソースとしてビルドし、S3 静的ホスティングバケットへ配置し、CloudFront Distribution で配信する。
2. THE CloudFront SHALL カスタムエラーレスポンスを設定し、HTTP 403 / 404 を `index.html` へリダイレクトして Vue Router の History モードをサポートする。
3. THE Frontend SHALL `VITE_API_BASE_URL` 環境変数で API Gateway エンドポイントを設定し、ビルド時に注入する。AWS リソース ARN や URL をハードコードしない。
4. WHERE ユーザーが TaskVista にアクセスするとき、THE CloudFront SHALL HTTPS で提供し、HTTP 平文アクセスを許可しない。
5. THE S3 フロントエンドホスティングバケット SHALL バケットポリシーにより CloudFront Origin Access Control（OAC）のみを許可し、直接のパブリックアクセスを拒否する。

---

### 要件 11：セキュリティと IAM 最小権限

**ユーザーストーリー：** セキュリティ責任者として、IAM 最小権限に従い、不正アクセスとデータ漏洩を防ぎたい。

#### 受入基準

1. THE Lambda SHALL 独立した IAM 実行ロールを使用し、各関数のロールは業務に必要な最小の DynamoDB 操作権限（テーブル名と操作種別を指定）のみを持つ。
2. THE Lambda SHALL すべてのユーザー入力（projectId、taskId、commentId、リクエストボディ各フィールド）を検証し、SQL / NoSQL インジェクション様の入力を拒否して HTTP 400 を返す。
3. THE System SHALL コード、平文の環境変数、ログに AWS アクセスキー、パスワード、JWT 秘密鍵などの機密を記録しない。
4. THE Cognito SHALL パスワードポリシーを設定し、長さ 8 文字以上、大文字・小文字・数字の組み合わせを要求する。
5. WHEN 認証済みユーザーが権限のない Project または Task を操作したとき、THE Lambda SHALL HTTP 403 を返し、対象リソースの有無を露出しない。

---

### 要件 12：クラウド移行互換性

**ユーザーストーリー：** アーキテクトとして、Google Cloud への移行を最小コストで行えるよう、アーキテクチャ上の余地を残したい。

#### 受入基準

1. THE Lambda の業務ロジックコード SHALL すべての AWS SDK 呼び出しを独立した Repository または Adapter 層にカプセル化し、業務関数内で AWS SDK を直接参照しない。
2. THE System SHALL 標準 RESTful API を用い、AppSync GraphQL Subscription や IoT WebSocket など AWS 固有プロトコルをフロント・バック通信の主経路にしない。
3. THE Frontend SHALL `VITE_API_BASE_URL` の単一入口でバックエンドと通信し、クラウド切替時はこの環境変数の変更のみで済むようにする。
4. THE DynamoDB データモデル SHALL camelCase 属性名を用い、コアエンティティフィールド（projectId、taskId、title、status、assigneeId、createdAt、updatedAt）は Google Cloud Firestore のドキュメントモデルと互換である。
5. THE System の API ドキュメント SHALL OpenAPI 3.0 で全エンドポイントを記述し、Google Cloud Endpoints への移行時の契約とする。
