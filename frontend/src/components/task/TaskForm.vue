<script setup lang="ts">
// タスク作成・編集フォームコンポーネント
// 担当者はプロジェクトメンバーのドロップダウン（userId + 表示名を保存）
import { ref, watch, computed } from 'vue'
import type { Task, TaskStatus, TaskPriority } from '@/types/task'
import { TASK_STATUSES, PRIORITY_LABELS } from '@/types/task'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import { resolveMemberDisplayName } from '@/utils/displayName'

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
const projectsStore = useProjectsStore()

// フォームの入力値
const title = ref('')
const description = ref('')
const status = ref<TaskStatus>('未着手')
const priority = ref<TaskPriority>('medium')
const requirement = ref('')
/** 担当者の Cognito sub（ドロップダウンの value） */
const assigneeId = ref<string | null>(null)
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

/**
 * 担当者候補 = このプロジェクトのメンバー
 * 表示名はクラウド（TaskVista-Users）で解決済みの displayName
 */
const assigneeOptions = computed(() => {
  const project =
    projectsStore.currentProject?.projectId === props.projectId
      ? projectsStore.currentProject
      : projectsStore.projects.find((p) => p.projectId === props.projectId)

  const members = project?.members ?? []
  return members
    .filter((m) => !!m.userId)
    .map((m) => ({
      // 表示名はクラウドプロフィール（自分なら auth.displayName）と連動
      title: resolveMemberDisplayName(m),
      value: m.userId!,
      subtitle: m.email,
    }))
})

function selectedAssigneeName(): string | undefined {
  if (!assigneeId.value) return undefined
  const opt = assigneeOptions.value.find((o) => o.value === assigneeId.value)
  return opt?.title
}

// ダイアログが開かれるたびにフォームを初期化し、メンバー一覧を最新化
watch(modelValue, async (isOpen) => {
  if (!isOpen) return

  // 担当者ドロップダウン用にプロジェクト（members）を取得
  try {
    if (
      projectsStore.currentProject?.projectId !== props.projectId ||
      !projectsStore.currentProject?.members?.length
    ) {
      await projectsStore.fetchProject(props.projectId)
    }
  } catch {
    // 失敗してもフォームは開く（担当者だけ空になる）
  }

  if (props.task) {
    title.value = props.task.title
    description.value = props.task.description ?? ''
    status.value = props.task.status
    priority.value = props.task.priority
    requirement.value = props.task.requirement ?? ''
    // 既存タスク: assigneeId があればそれを使い、名前のみならメンバーから逆引き
    assigneeId.value = props.task.assigneeId ?? null
    if (!assigneeId.value && props.task.assigneeName) {
      const byName = assigneeOptions.value.find(
        (o) => o.title === props.task!.assigneeName,
      )
      assigneeId.value = byName?.value ?? null
    }
    dueDate.value = props.task.dueDate ?? ''
  } else {
    title.value = ''
    description.value = ''
    status.value = props.defaultStatus ?? '未着手'
    priority.value = 'medium'
    requirement.value = ''
    assigneeId.value = null
    dueDate.value = ''
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
    requirement: requirement.value.trim() || undefined,
    // 両方送る: ダッシュボードは assigneeId、画面表示は assigneeName
    assigneeId: assigneeId.value || undefined,
    assigneeName: selectedAssigneeName(),
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
                v-model="requirement"
                label="要望（任意）"
                hide-details
              />
            </v-col>
          </v-row>

          <!-- 担当者（メンバー選択）と期日 -->
          <v-row dense class="mb-1 mt-3">
            <v-col cols="6">
              <v-select
                v-model="assigneeId"
                :items="assigneeOptions"
                item-title="title"
                item-value="value"
                label="担当者"
                placeholder="メンバーを選択"
                clearable
                hide-details="auto"
                :hint="
                  assigneeOptions.length
                    ? 'プロジェクトメンバーから選択（表示名はクラウドの設定名）'
                    : 'メンバーがいません。先にプロジェクトへメンバーを追加してください'
                "
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
