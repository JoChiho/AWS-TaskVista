<script setup lang="ts">
// タスク作成・編集フォームコンポーネント
import { ref, watch } from 'vue'
import type { Task, TaskStatus, TaskPriority } from '@/types/task'
import { TASK_STATUSES, PRIORITY_LABELS } from '@/types/task'
import { useTasksStore } from '@/stores/tasks'

const props = defineProps<{
  projectId: string
  task?: Task
  defaultStatus?: TaskStatus
}>()

const emit = defineEmits<{
  saved: [task: Task]
}>()

const modelValue = defineModel<boolean>()
const tasksStore = useTasksStore()

// フォームの入力値
const title = ref('')
const description = ref('')
const status = ref<TaskStatus>('未着手')
const priority = ref<TaskPriority>('medium')
const location = ref('')
const requirement = ref('')
const assigneeName = ref('')
const dueDate = ref('')

// バリデーションルール
const titleRules = [
  (v: string) => !!v || 'タイトルは必須項目です',
  (v: string) => v.length <= 200 || 'タイトルは 200 文字以内で入力してください',
]

/** ステータスの選択肢 */
const statusOptions = TASK_STATUSES.map((s) => ({ title: s, value: s }))

/** 優先度の選択肢 */
const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, title]) => ({
  title,
  value,
}))

// ダイアログが開かれるたびにフォームを初期化する
watch(modelValue, (isOpen) => {
  if (isOpen) {
    if (props.task) {
      // 編集モード：既存の値を設定する
      title.value = props.task.title
      description.value = props.task.description ?? ''
      status.value = props.task.status
      priority.value = props.task.priority
      location.value = props.task.location ?? ''
      requirement.value = props.task.requirement ?? ''
      assigneeName.value = props.task.assigneeName ?? ''
      dueDate.value = props.task.dueDate ?? ''
    } else {
      // 作成モード：デフォルト値を設定する
      title.value = ''
      description.value = ''
      status.value = props.defaultStatus ?? '未着手'
      priority.value = 'medium'
      location.value = ''
      requirement.value = ''
      assigneeName.value = ''
      dueDate.value = ''
    }
  }
})

/** フォームを送信する（作成 or 更新） */
async function handleSubmit() {
  if (!title.value.trim()) return

  const payload = {
    title: title.value.trim(),
    description: description.value.trim() || undefined,
    status: status.value,
    priority: priority.value,
    location: location.value.trim() || undefined,
    requirement: requirement.value.trim() || undefined,
    assigneeName: assigneeName.value.trim() || undefined,
    dueDate: dueDate.value || undefined,
  }

  let saved: Task
  if (props.task) {
    saved = await tasksStore.updateTask(props.task.taskId, payload)
  } else {
    saved = await tasksStore.createTask(props.projectId, payload)
  }

  emit('saved', saved)
  modelValue.value = false
}

const isEditMode = !!props.task
</script>

<template>
  <v-dialog v-model="modelValue" max-width="640" persistent scrollable>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        {{ isEditMode ? 'タスクを編集する' : '新しいタスクを追加する' }}
      </v-card-title>

      <v-divider />

      <v-card-text class="px-5 py-4">
        <v-form @submit.prevent="handleSubmit">
          <!-- タイトル（必須） -->
          <v-text-field
            v-model="title"
            label="タイトル *"
            :rules="titleRules"
            placeholder="タスクのタイトルを入力してください"
            class="mb-3"
            counter="200"
            autofocus
          />

          <!-- ステータスと優先度（横並び） -->
          <v-row dense class="mb-1">
            <v-col cols="6">
              <v-select
                v-model="status"
                :items="statusOptions"
                label="ステータス"
                hide-details
              />
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="priority"
                :items="priorityOptions"
                label="優先度"
                hide-details
              />
            </v-col>
          </v-row>

          <!-- 場所と要望（横並び） -->
          <v-row dense class="mb-1 mt-3">
            <v-col cols="6">
              <v-text-field
                v-model="location"
                label="場所（任意）"
                placeholder="例：東京オフィス"
                hide-details
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="requirement"
                label="要望（任意）"
                hide-details
              />
            </v-col>
          </v-row>

          <!-- 担当者と期日（横並び） -->
          <v-row dense class="mb-1 mt-3">
            <v-col cols="6">
              <v-text-field
                v-model="assigneeName"
                label="担当者（任意）"
                placeholder="例：鮫島 / 徐"
                hint="人名で記録します"
                persistent-hint
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="dueDate"
                label="期日（任意）"
                type="date"
                hide-details
              />
            </v-col>
          </v-row>

          <!-- 説明（任意） -->
          <v-textarea
            v-model="description"
            label="説明（任意）"
            placeholder="タスクの詳細を入力してください"
            rows="3"
            class="mt-3"
            counter="5000"
          />
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-5 py-3">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="tasksStore.isLoading"
          @click="modelValue = false"
        >
          キャンセル
        </v-btn>
        <v-btn
          color="primary"
          :loading="tasksStore.isLoading"
          :disabled="!title.trim()"
          @click="handleSubmit"
        >
          保存する
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
