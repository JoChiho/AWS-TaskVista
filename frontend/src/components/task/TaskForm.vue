<script setup lang="ts">
// タスク作成・編集フォーム
// 完了度は TaskDetail で調整するため、ここでは出さない
import { ref, watch, computed } from 'vue'
import type { Task, TaskStatus, TaskPriority, TaskAssignee } from '@/types/task'
import {
  TASK_STATUSES,
  PRIORITY_LABELS,
  STATUS_COLORS,
  PRIORITY_COLORS,
} from '@/types/task'
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

const title = ref('')
const description = ref('')
const status = ref<TaskStatus>('未着手')
const priority = ref<TaskPriority>('medium')
const requirement = ref('')
/** 担当者 userId の配列（複数） */
const selectedAssigneeIds = ref<string[]>([])
const dueDate = ref('')

const titleRules = [
  (v: string) => !!v || 'タスク名は必須項目です',
  (v: string) => v.length <= 200 || 'タスク名は 200 文字以内で入力してください',
]

const statusOptions = TASK_STATUSES.map((s) => ({ title: s, value: s }))

const priorityOptions = Object.entries(PRIORITY_LABELS).map(([value, title]) => ({
  title,
  value,
}))

const isEditMode = computed(() => !!props.task)

const assigneeOptions = computed(() => {
  const project =
    projectsStore.currentProject?.projectId === props.projectId
      ? projectsStore.currentProject
      : projectsStore.projects.find((p) => p.projectId === props.projectId)

  const members = project?.members ?? []
  return members
    .filter((m) => !!m.userId)
    .map((m) => ({
      title: resolveMemberDisplayName(m),
      value: m.userId!,
      subtitle: m.email,
    }))
})

function buildAssigneesPayload(): TaskAssignee[] {
  const result: TaskAssignee[] = []
  for (const id of selectedAssigneeIds.value) {
    const opt = assigneeOptions.value.find((o) => o.value === id)
    if (!opt) continue
    result.push({ userId: id, displayName: opt.title })
  }
  return result
}

function initAssigneeSelection(task: Task) {
  const ids: string[] = []
  if (task.assignees && task.assignees.length > 0) {
    for (const a of task.assignees) {
      if (a.userId) {
        ids.push(a.userId)
      } else if (a.displayName) {
        const byName = assigneeOptions.value.find((o) => o.title === a.displayName)
        if (byName) ids.push(byName.value)
      }
    }
  } else if (task.assigneeId) {
    ids.push(task.assigneeId)
  } else if (task.assigneeName) {
    const byName = assigneeOptions.value.find((o) => o.title === task.assigneeName)
    if (byName) ids.push(byName.value)
  }
  selectedAssigneeIds.value = [...new Set(ids)]
}

watch(modelValue, async (isOpen) => {
  if (!isOpen) return

  try {
    if (
      projectsStore.currentProject?.projectId !== props.projectId ||
      !projectsStore.currentProject?.members?.length
    ) {
      await projectsStore.fetchProject(props.projectId)
    }
  } catch {
    // 失敗してもフォームは開く
  }

  if (props.task) {
    title.value = props.task.title
    description.value = props.task.description ?? ''
    status.value = props.task.status
    priority.value = props.task.priority
    requirement.value = props.task.requirement ?? ''
    dueDate.value = props.task.dueDate ?? ''
    initAssigneeSelection(props.task)
  } else {
    title.value = ''
    description.value = ''
    status.value = props.defaultStatus ?? '未着手'
    priority.value = 'medium'
    requirement.value = ''
    selectedAssigneeIds.value = []
    dueDate.value = ''
  }
})

async function handleSubmit() {
  if (!title.value.trim()) return

  const assignees = buildAssigneesPayload()
  const primary = assignees[0]

  // 完了度は詳細画面で調整。編集時は送らず既存値を保持。
  // 新規作成・ステータス変更時の 完了/未着手 は API 側で完了度を合わせる。
  const payload = {
    title: title.value.trim(),
    description: description.value.trim() || undefined,
    status: status.value,
    priority: priority.value,
    requirement: requirement.value.trim() || undefined,
    assignees,
    assigneeId: primary?.userId,
    assigneeName: primary?.displayName,
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
</script>

<template>
  <v-dialog
    v-model="modelValue"
    persistent
    scrollable
    content-class="task-form-dialog"
    :max-width="760"
  >
    <v-card class="task-form-card d-flex flex-column" rounded="xl">
      <!-- ヘッダー（詳細と同じトーン） -->
      <div class="form-header flex-grow-0">
        <div class="d-flex align-center px-6 pt-5 pb-2">
          <div class="flex-grow-1 min-w-0">
            <p class="form-kicker mb-1">
              {{ isEditMode ? 'タスクを編集' : '新規タスク' }}
            </p>
            <h2 class="form-heading text-h6 font-weight-bold mb-0">
              {{ isEditMode ? '内容を更新する' : '新しいタスクを追加する' }}
            </h2>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :disabled="tasksStore.isLoading"
            @click="modelValue = false"
          />
        </div>

        <!-- タイトル（最重要・詳細のタイトル位置に相当） -->
        <div class="px-6 pb-5">
          <div class="section-label mb-2">
            <v-icon size="18" class="mr-1">mdi-format-title</v-icon>
            タスク名 *
          </div>
          <v-text-field
            v-model="title"
            :rules="titleRules"
            placeholder="何をするタスクか、一目で分かる名前"
            counter="200"
            autofocus
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="title-field"
            bg-color="surface"
          />
          <div class="d-flex flex-wrap align-center ga-2 mt-3">
            <v-chip
              :color="STATUS_COLORS[status]"
              size="small"
              label
              variant="flat"
            >
              {{ status }}
            </v-chip>
            <v-chip
              :color="PRIORITY_COLORS[priority]"
              size="small"
              label
              variant="tonal"
            >
              優先度: {{ PRIORITY_LABELS[priority] }}
            </v-chip>
          </div>
        </div>
      </div>

      <v-card-text class="form-body px-6 py-5 flex-grow-1">
        <v-form @submit.prevent="handleSubmit">
          <!-- 要望 -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-bullseye-arrow</v-icon>
              要望
            </div>
            <div class="field-card field-card--requirement">
              <v-textarea
                v-model="requirement"
                placeholder="依頼元の要望・ゴール・受け入れ条件など"
                rows="3"
                auto-grow
                hide-details
                variant="plain"
                density="comfortable"
                class="inner-field"
              />
            </div>
          </section>

          <!-- 説明 -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-text-box-outline</v-icon>
              説明
            </div>
            <div class="field-card field-card--description">
              <v-textarea
                v-model="description"
                placeholder="実装方針、注意点、関連リンクなど詳細を記入"
                rows="4"
                auto-grow
                counter="5000"
                variant="plain"
                density="comfortable"
                class="inner-field"
              />
            </div>
          </section>

          <!-- ステータス / 優先度 / 期日 -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-tune-variant</v-icon>
              ステータス・優先度・期日
            </div>
            <div class="meta-fields">
              <v-select
                v-model="status"
                :items="statusOptions"
                label="ステータス"
                hide-details
                variant="outlined"
                density="comfortable"
              />
              <v-select
                v-model="priority"
                :items="priorityOptions"
                label="優先度"
                hide-details
                variant="outlined"
                density="comfortable"
              />
              <v-text-field
                v-model="dueDate"
                label="期日（任意）"
                type="date"
                hide-details
                variant="outlined"
                density="comfortable"
              />
            </div>
          </section>

          <!-- 担当者 -->
          <section class="form-section mb-2">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-account-multiple-outline</v-icon>
              担当者（複数可）
            </div>
            <v-select
              v-model="selectedAssigneeIds"
              :items="assigneeOptions"
              item-title="title"
              item-value="value"
              placeholder="メンバーを選択"
              multiple
              chips
              closable-chips
              clearable
              hide-details="auto"
              variant="outlined"
              density="comfortable"
              :hint="
                assigneeOptions.length
                  ? 'プロジェクトメンバーから複数選択できます'
                  : 'メンバーがいません。先にプロジェクトへメンバーを追加してください'
              "
              persistent-hint
            >
              <template #chip="{ props: chipProps, item }">
                <v-chip
                  v-bind="chipProps"
                  size="small"
                  color="primary"
                  variant="tonal"
                >
                  <v-avatar start size="20" color="primary">
                    <span class="text-caption text-white" style="font-size: 9px">
                      {{ String(item.title).slice(0, 2).toUpperCase() }}
                    </span>
                  </v-avatar>
                  {{ item.title }}
                </v-chip>
              </template>
            </v-select>
          </section>
        </v-form>
      </v-card-text>

      <div class="form-footer flex-grow-0 d-flex align-center px-6 py-4">
        <v-spacer />
        <v-btn
          variant="text"
          size="large"
          class="mr-2"
          :disabled="tasksStore.isLoading"
          @click="modelValue = false"
        >
          キャンセル
        </v-btn>
        <v-btn
          color="primary"
          size="large"
          rounded="lg"
          :loading="tasksStore.isLoading"
          :disabled="!title.trim()"
          prepend-icon="mdi-content-save-outline"
          @click="handleSubmit"
        >
          保存する
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style>
/* teleported dialog content */
.task-form-dialog.v-overlay__content {
  width: min(760px, calc(100vw - 24px)) !important;
  max-width: min(760px, calc(100vw - 24px)) !important;
  margin: 12px !important;
}
</style>

<style scoped>
.task-form-card {
  max-height: min(92vh, 920px);
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.form-header {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: linear-gradient(
    165deg,
    rgba(var(--v-theme-primary), 0.1) 0%,
    rgba(var(--v-theme-primary), 0.03) 45%,
    rgba(var(--v-theme-surface), 1) 100%
  );
}

.form-kicker {
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.72rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin: 0;
}

.form-heading {
  letter-spacing: -0.01em;
}

.title-field :deep(.v-field) {
  font-size: 1.15rem;
  font-weight: 600;
}

.form-body {
  overflow-y: auto;
  min-height: 0;
}

.section-label {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 10px;
}

.field-card {
  border-radius: 14px;
  padding: 6px 12px 4px;
}

.field-card--requirement {
  background: rgba(var(--v-theme-warning), 0.12);
  border-left: 5px solid rgb(var(--v-theme-warning));
}

.field-card--description {
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.inner-field :deep(textarea) {
  font-size: 1rem;
  line-height: 1.65;
}

.meta-fields {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

@media (max-width: 640px) {
  .meta-fields {
    grid-template-columns: 1fr;
  }
}

.form-footer {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-on-surface), 0.02);
}

.min-w-0 {
  min-width: 0;
}
</style>
