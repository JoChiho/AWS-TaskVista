<script setup lang="ts">
// かんばんタスクカード
// - 左のドラッグハンドルでのみ移動（Sortable がカード本体の click を奪わない）
// - カード本体クリックで詳細を開く
import { storeToRefs } from 'pinia'
import type { Task } from '@/types/task'
import {
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  normalizeCompletion,
  completionColor,
} from '@/types/task'
import { formatAssigneeList, resolveAssigneeLabels } from '@/utils/displayName'
import { useDisplayNamesStore } from '@/stores/displayNames'

const props = defineProps<{
  task: Task
}>()

const emit = defineEmits<{
  open: [task: Task]
}>()

const displayNamesStore = useDisplayNamesStore()
const { byUserId, byEmail } = storeToRefs(displayNamesStore)

function formatDueDate(dueDate: string): string {
  const d = new Date(dueDate)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}.${day}`
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function isDueSoon(dueDate?: string): boolean {
  if (!dueDate) return false
  const due = new Date(dueDate)
  const now = new Date()
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 3
}

function assigneeLabel(task: Task): string {
  void byUserId.value
  void byEmail.value
  return formatAssigneeList(task)
}

function assigneeCount(task: Task): number {
  void byUserId.value
  void byEmail.value
  return resolveAssigneeLabels(task).length
}

function progress(task: Task): number {
  return normalizeCompletion(task.completionPercent)
}

function onBodyClick() {
  emit('open', props.task)
}
</script>

<template>
  <div class="task-card-root">
    <button
      type="button"
      class="drag-handle"
      title="ドラッグして移動"
      aria-label="ドラッグして移動"
      @click.stop
    >
      <v-icon size="18" color="medium-emphasis">mdi-drag-vertical</v-icon>
    </button>

    <v-card
      rounded="lg"
      elevation="1"
      class="task-card"
      role="button"
      tabindex="0"
      @click="onBodyClick"
      @keydown.enter.prevent="onBodyClick"
      @keydown.space.prevent="onBodyClick"
    >
      <v-card-text class="pa-3">
        <p class="text-body-2 font-weight-medium mb-1 task-title">
          {{ task.title }}
        </p>

        <div v-if="task.requirement" class="mb-2">
          <span class="text-caption text-medium-emphasis d-block mb-0">要望</span>
          <p class="text-body-2 text-medium-emphasis ma-0 task-requirement">
            {{ task.requirement }}
          </p>
        </div>

        <!-- 完了度バー -->
        <div v-if="progress(task) > 0 || task.status === '進行中'" class="mb-2">
          <div class="d-flex align-center justify-space-between mb-0">
            <span class="text-caption text-medium-emphasis">完了度</span>
            <span
              class="text-caption font-weight-bold"
              :class="`text-${completionColor(progress(task))}`"
            >
              {{ progress(task) }}%
            </span>
          </div>
          <v-progress-linear
            :model-value="progress(task)"
            :color="completionColor(progress(task))"
            height="4"
            rounded
          />
        </div>

        <div class="d-flex align-center flex-wrap gap-1 mt-2">
          <v-chip
            :color="PRIORITY_COLORS[task.priority]"
            size="x-small"
            label
            variant="tonal"
          >
            {{ PRIORITY_LABELS[task.priority] }}
          </v-chip>

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

          <span
            v-if="task.dueDate"
            class="text-caption"
            :class="{
              'text-error font-weight-bold': isOverdue(task.dueDate),
              'text-warning font-weight-bold':
                isDueSoon(task.dueDate) && !isOverdue(task.dueDate),
              'text-medium-emphasis':
                !isOverdue(task.dueDate) && !isDueSoon(task.dueDate),
            }"
          >
            <v-icon size="10" class="mr-1">mdi-calendar</v-icon>
            {{ formatDueDate(task.dueDate) }}
          </span>

          <span
            v-if="assigneeLabel(task)"
            class="text-caption text-medium-emphasis ml-1 text-truncate"
            style="max-width: 88px"
            :title="assigneeLabel(task)"
          >
            <v-icon v-if="assigneeCount(task) > 1" size="10" class="mr-0">
              mdi-account-multiple
            </v-icon>
            {{
              assigneeCount(task) > 1
                ? `${resolveAssigneeLabels(task)[0]} 他${assigneeCount(task) - 1}`
                : assigneeLabel(task)
            }}
          </span>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.task-card-root {
  display: flex;
  align-items: stretch;
  gap: 2px;
}

.drag-handle {
  flex: 0 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: grab;
  border-radius: 6px;
  touch-action: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.task-card {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.1s ease;
}

.task-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12) !important;
  transform: translateY(-1px);
}

.task-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}

.task-requirement {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}
</style>
