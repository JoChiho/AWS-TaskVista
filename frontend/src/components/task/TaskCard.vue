<script setup lang="ts">
// かんばんタスクカードコンポーネント
import type { Task } from '@/types/task'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/task'

defineProps<{
  task: Task
}>()

defineEmits<{
  click: [task: Task]
}>()

/** 期日をフォーマットする */
function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
  })
}

/** 期日が超過しているかを判定する */
function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

/** 期日が 3 日以内かを判定する */
function isDueSoon(dueDate?: string): boolean {
  if (!dueDate) return false
  const due = new Date(dueDate)
  const now = new Date()
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 3
}
</script>

<template>
  <!-- タスクカード本体（クリックで詳細を開く） -->
  <v-card
    rounded="lg"
    elevation="1"
    class="task-card"
    @click="$emit('click', task)"
  >
    <v-card-text class="pa-3">
      <!-- タスクタイトル -->
      <p
        class="text-body-2 font-weight-medium mb-2"
        style="
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
          line-height: 1.4;
        "
      >
        {{ task.title }}
      </p>

      <!-- フッター：優先度・期日・担当者 -->
      <div class="d-flex align-center flex-wrap gap-1 mt-2">
        <!-- 優先度チップ -->
        <v-chip
          :color="PRIORITY_COLORS[task.priority]"
          size="x-small"
          label
          variant="tonal"
        >
          {{ PRIORITY_LABELS[task.priority] }}
        </v-chip>

        <!-- コメント数 -->
        <v-chip
          v-if="task.commentCount && task.commentCount > 0"
          size="x-small"
          variant="text"
          prepend-icon="mdi-comment-outline"
          class="text-medium-emphasis"
        >
          {{ task.commentCount }}
        </v-chip>

        <v-spacer />

        <!-- 期日 -->
        <span
          v-if="task.dueDate"
          class="text-caption"
          :class="{
            'text-error font-weight-bold': isOverdue(task.dueDate),
            'text-warning font-weight-bold': isDueSoon(task.dueDate) && !isOverdue(task.dueDate),
            'text-medium-emphasis': !isOverdue(task.dueDate) && !isDueSoon(task.dueDate),
          }"
        >
          <v-icon size="10" class="mr-1">mdi-calendar</v-icon>
          {{ formatDueDate(task.dueDate) }}
        </span>

        <!-- 担当者アバター（人名がある場合のみ） -->
        <v-avatar
          v-if="task.assigneeName"
          size="20"
          color="primary"
          :title="task.assigneeName"
        >
          <span style="font-size: 9px; color: white">
            {{ task.assigneeName.slice(0, 2).toUpperCase() }}
          </span>
        </v-avatar>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
/* カード全体をクリック可能に見せる */
.task-card {
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.1s ease;
}

.task-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12) !important;
  transform: translateY(-1px);
}
</style>
