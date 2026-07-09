---
inclusion: always
---

# Vue 3 + Vuetify 3 开发规范

- 使用 <script setup> + Composition API
- 组件文件名：PascalCase.vue
- 页面组件后缀 View（xxxView.vue）
- Props 使用 defineProps() + 类型
- 事件使用 defineEmits()
- 样式：Vuetify 主题变量优先，少用自定义 CSS
- 响应式：ref / reactive / computed 合理使用
- Kanban：使用 vuedraggable + Vuetify v-card
- 表格：优先 v-data-table，支持排序、筛选、分页