---
inclusion: always
---

# TaskVista プロジェクト構成規約

## 推奨ディレクトリ構成（MVP）
AWS-TaskVista/
├── frontend/                # Vue 3 + Vite フロントエンド
│   ├── src/                 # Vue ソース（views、components、stores、api）
│   ├── public/
│   └── package.json
├── backend/                 # Lambda 関数コード（Node.js + TypeScript）
│   └── src/
│       ├── shared/          # 共通モジュール（logger、errors、response）
│       ├── projects/        # Projects Lambda
│       ├── tasks/           # Tasks Lambda
│       ├── comments/        # Comments Lambda
│       ├── attachments/     # Attachments Lambda
│       └── dashboard/       # Dashboard Lambda
├── .kiro/                   # Kiro 設定
│   ├── steering/            # 本ディレクトリの steering ファイル群
│   └── specs/               # Spec フォルダ
├── venv/                    # Python 仮想環境（任意）
└── ...

## 命名規約
- Vue コンポーネント：PascalCase + View / Component サフィックス
- Task ID / Project ID：UUID または意味のある文字列
- DynamoDB 属性：camelCase
- Git Commit：Conventional Commits（feat: / fix: / refactor: など）
