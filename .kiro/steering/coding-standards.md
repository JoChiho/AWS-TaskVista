---
inclusion: always
---

# コーディング規約

- 常に TypeScript（strict モード）を使用する
- 関数・変数名：camelCase、意味が伝わる名前にする
- エラー処理：try-catch + 分かりやすいエラーメッセージを使用する
- コメント：複雑なロジックには必ずコメントを付ける。TODO は統一フォーマットにする
- コードフォーマット：ESLint + Prettier で自動整形する
- Git：Conventional Commits + 小さな PR
- テスト：MVP 段階ではコア API とコンポーネントを重点的にカバーする
