<script setup lang="ts">
// タスクフィルターコンポーネント
// 担当者・優先度・ステータスによるクライアントサイドフィルタリング
import { computed } from 'vue'
import type { Task } from '@/types/task'
import { TASK_STATUSES, PRIORITY_LABELS } from '@/types/task'
import { resolveAssigneeDisplayName } from '@/utils/displayName'

const props = defineProps<{
  tasks: Task[]
  showStatusFilter?: boolean
}>()

const emit = defineEmits<{
  reset: []
}>()

// v-model バインディング（各フィルター条件）— 担当者は表示名テキストで照合
const assignee = defineModel<string | null>('assignee')
const priority = defineModel<string | null>('priority')
const status = defineModel<string | null>('status')

/** フィルターに使用できる担当者名の一覧を動的に生成する（表示名解決後） */
const assigneeOptions = computed(() => {
  const names = new Set<string>()
  for (const task of props.tasks) {
    const label = resolveAssigneeDisplayName(task)
    if (label) names.add(label)
  }
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'ja'))
    .map((name) => ({ title: name, value: name }))
})

/** 優先度の選択肢 */
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, title]) => ({
  title,
  value,
}))

/** ステータスの選択肢 */
const statusOptions = TASK_STATUSES.map((s) => ({ title: s, value: s }))

/** フィルターが何かひとつでも適用されているかを判定する */
const hasActiveFilter = computed(
  () => !!assignee.value || !!priority.value || !!status.value,
)
</script>

<template>
  <div class="d-flex align-center flex-wrap gap-2">
    <!-- 担当者フィルター -->
    <v-select
      v-model="assignee"
      :items="assigneeOptions"
      label="担当者"
      clearable
      hide-details
      density="compact"
      style="min-width: 140px; max-width: 180px"
    />

    <!-- 優先度フィルター -->
    <v-select
      v-model="priority"
      :items="priorityOptions"
      label="優先度"
      clearable
      hide-details
      density="compact"
      style="min-width: 120px; max-width: 150px"
    />

    <!-- ステータスフィルター（テーブルビューのみ表示） -->
    <v-select
      v-if="showStatusFilter"
      v-model="status"
      :items="statusOptions"
      label="ステータス"
      clearable
      hide-details
      density="compact"
      style="min-width: 150px; max-width: 180px"
    />

    <!-- フィルターリセットボタン -->
    <v-btn
      v-if="hasActiveFilter"
      variant="text"
      color="medium-emphasis"
      size="small"
      prepend-icon="mdi-filter-remove"
      @click="emit('reset')"
    >
      リセット
    </v-btn>
  </div>
</template>
