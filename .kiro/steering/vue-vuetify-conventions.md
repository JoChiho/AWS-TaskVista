---
inclusion: always
---

# Vue 3 + Vuetify 3 開発規約

- `<script setup>` + Composition API を使用する
- コンポーネントファイル名：PascalCase.vue
- ページコンポーネントは View サフィックス（xxxView.vue）
- Props は `defineProps()` + 型を使用する
- イベントは `defineEmits()` を使用する
- スタイル：Vuetify テーマ変数を優先し、独自 CSS は最小限にする
- リアクティブ：`ref` / `reactive` / `computed` を適切に使う
- Kanban：vuedraggable + Vuetify `v-card` を使用する
- テーブル：`v-data-table` を優先し、ソート・フィルター・ページングに対応する
