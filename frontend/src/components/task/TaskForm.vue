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
import { resolveMemberDisplayName, avatarLabelFromName } from '@/utils/displayName'
import {
  breadcrumbPath,
  childrenOf,
  depthOfTask,
  isParentTask,
} from '@/utils/wbs'

const props = defineProps<{
  projectId: string
  task?: Task
  defaultStatus?: TaskStatus
  /** 新規作成時の既定親タスク（テーブルの + から渡す） */
  defaultParentTaskId?: string | null
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
/** 評価者 userId の配列（レビュー待ち） */
const selectedReviewerIds = ref<string[]>([])
/** 日付 YYYY-MM-DD */
const plannedStartDate = ref('')
const plannedDueDate = ref('')
const actualStartDate = ref('')
const actualDueDate = ref('')
/** 予定工数（人日）。空文字 = 未設定 */
const estimatedEffortDays = ref<string>('')
/** 実績工数（人日）。空文字 = 未設定 */
const actualEffortDays = ref<string>('')
/**
 * WBS 親選択（2 段階）
 * - L1: 第1階層（ルート）から選択
 * - L2: 選んだ L1 配下の第2階層（任意）
 * 親として設定されるのは L2 があれば L2、なければ L1、どちらもなければルート
 */
const parentL1Id = ref<string | null>(null)
const parentL2Id = ref<string | null>(null)

/** 提出用の親タスク ID */
const resolvedParentTaskId = computed<string | null>(() => {
  if (parentL2Id.value) return parentL2Id.value
  if (parentL1Id.value) return parentL1Id.value
  return null
})

/** 自分と子孫は親候補から除外 */
function isExcludedAsParent(taskId: string): boolean {
  const selfId = props.task?.taskId
  if (!selfId) return false
  if (taskId === selfId) return true
  const all = tasksStore.activeTasks
  const stack = [selfId]
  const exclude = new Set<string>([selfId])
  while (stack.length) {
    const id = stack.pop()!
    for (const t of all) {
      if (t.parentTaskId === id && !exclude.has(t.taskId)) {
        exclude.add(t.taskId)
        stack.push(t.taskId)
      }
    }
  }
  return exclude.has(taskId)
}

const parentL1Options = computed(() => {
  const roots = childrenOf(tasksStore.activeTasks, null)
  return roots
    .filter((t) => !isExcludedAsParent(t.taskId))
    .map((t) => ({
      title: `${t.wbsCode ? t.wbsCode + ' ' : ''}${t.title}`,
      value: t.taskId,
    }))
})

const parentL2Options = computed(() => {
  if (!parentL1Id.value) return []
  return childrenOf(tasksStore.activeTasks, parentL1Id.value)
    .filter((t) => !isExcludedAsParent(t.taskId))
    .map((t) => ({
      title: `${t.wbsCode ? t.wbsCode + ' ' : ''}${t.title}`,
      value: t.taskId,
    }))
})

/** L1 変更時に L2 をクリア（L2 が新 L1 配下でない場合） */
watch(parentL1Id, (l1) => {
  if (!l1) {
    parentL2Id.value = null
    return
  }
  if (parentL2Id.value) {
    const stillUnder = childrenOf(tasksStore.activeTasks, l1).some(
      (t) => t.taskId === parentL2Id.value,
    )
    if (!stillUnder) parentL2Id.value = null
  }
})

/** 既定親 / 編集中の親から L1・L2 選択を復元 */
function applyParentCascadeFromParentId(parentId: string | null | undefined) {
  parentL1Id.value = null
  parentL2Id.value = null
  if (!parentId) return

  const all = tasksStore.activeTasks
  const parent = all.find((t) => t.taskId === parentId)
  if (!parent) {
    // 一覧に無い場合でも ID だけ L1 として仮置き
    parentL1Id.value = parentId
    return
  }

  const depth = depthOfTask(parent, all)
  if (depth <= 0) {
    // 親が第1層 → L1 のみ
    parentL1Id.value = parent.taskId
    return
  }
  if (depth === 1) {
    // 親が第2層 → 祖父母を L1、親を L2
    parentL1Id.value = parent.parentTaskId ?? null
    parentL2Id.value = parent.taskId
    return
  }
  // 第3層を親にはできない想定だが、念のため直近の第2層まで
  const path = breadcrumbPath(parent, all)
  if (path[0]) parentL1Id.value = path[0].taskId
  if (path[1]) parentL2Id.value = path[1].taskId
}

/** 編集中かつ子がある親 → 予定/実績・担当は集計（手入力不可） */
const scheduleLocked = computed(
  () => !!(props.task && isParentTask(props.task, tasksStore.activeTasks)),
)

/** 親のステータス: 強制進行中のみ編集不可。それ以外は候補内で選択可 */
const statusLocked = computed(
  () => scheduleLocked.value && props.task?.rollup?.statusMode === 'forced_progress',
)

const statusSelectItems = computed(() => {
  if (scheduleLocked.value && props.task?.rollup?.allowedStatuses?.length) {
    return props.task.rollup.allowedStatuses.map((s) => ({ title: s, value: s }))
  }
  return statusOptions
})

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

/** レビュー待ちのとき評価者 UI を表示 */
const showReviewers = computed(() => status.value === 'レビュー待ち')

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

function buildMemberPayload(ids: string[]): TaskAssignee[] {
  const result: TaskAssignee[] = []
  for (const id of ids) {
    const opt = assigneeOptions.value.find((o) => o.value === id)
    if (!opt) continue
    result.push({ userId: id, displayName: opt.title })
  }
  return result
}

function buildAssigneesPayload(): TaskAssignee[] {
  return buildMemberPayload(selectedAssigneeIds.value)
}

function buildReviewersPayload(): TaskAssignee[] {
  return buildMemberPayload(selectedReviewerIds.value)
}

function initIdsFromPeople(
  people?: Array<{ userId?: string; displayName?: string }>,
  fallbackId?: string,
  fallbackName?: string,
): string[] {
  const ids: string[] = []
  if (people && people.length > 0) {
    for (const a of people) {
      if (a.userId) {
        ids.push(a.userId)
      } else if (a.displayName) {
        const byName = assigneeOptions.value.find((o) => o.title === a.displayName)
        if (byName) ids.push(byName.value)
      }
    }
  } else if (fallbackId) {
    ids.push(fallbackId)
  } else if (fallbackName) {
    const byName = assigneeOptions.value.find((o) => o.title === fallbackName)
    if (byName) ids.push(byName.value)
  }
  return [...new Set(ids)]
}

function initAssigneeSelection(task: Task) {
  selectedAssigneeIds.value = initIdsFromPeople(
    task.assignees,
    task.assigneeId,
    task.assigneeName,
  )
}

function initReviewerSelection(task: Task) {
  selectedReviewerIds.value = initIdsFromPeople(task.reviewers)
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
    plannedStartDate.value =
      props.task.plannedStartDate ?? props.task.startDate ?? ''
    plannedDueDate.value = props.task.plannedDueDate ?? props.task.dueDate ?? ''
    actualStartDate.value = props.task.actualStartDate ?? ''
    actualDueDate.value = props.task.actualDueDate ?? ''
    estimatedEffortDays.value =
      props.task.estimatedEffortDays != null
        ? String(props.task.estimatedEffortDays)
        : ''
    actualEffortDays.value =
      props.task.actualEffortDays != null ? String(props.task.actualEffortDays) : ''
    applyParentCascadeFromParentId(props.task.parentTaskId ?? null)
    // 親は rollup 済み status / 担当を表示
    if (props.task.rollup && (props.task.childCount ?? 0) > 0) {
      status.value = props.task.rollup.status
    }
    initAssigneeSelection(props.task)
    initReviewerSelection(props.task)
  } else {
    title.value = ''
    description.value = ''
    status.value = props.defaultStatus ?? '未着手'
    priority.value = 'medium'
    requirement.value = ''
    selectedAssigneeIds.value = []
    selectedReviewerIds.value = []
    plannedStartDate.value = ''
    plannedDueDate.value = ''
    actualStartDate.value = ''
    actualDueDate.value = ''
    estimatedEffortDays.value = ''
    actualEffortDays.value = ''
    applyParentCascadeFromParentId(props.defaultParentTaskId ?? null)
  }
})

function parseEffortDays(rawInput: string): number | null | undefined {
  const raw = rawInput.trim()
  if (!raw) {
    // 編集時はクリア、新規時は未送信
    return props.task ? null : undefined
  }
  const n = Number(raw)
  if (Number.isNaN(n) || n < 0) return props.task ? null : undefined
  return n
}

function optionalDatePayload(value: string): string | null | undefined {
  if (value) return value
  return props.task ? null : undefined
}

async function handleSubmit() {
  if (!title.value.trim()) return

  const assignees = buildAssigneesPayload()
  const primary = assignees[0]
  const plannedEffort = parseEffortDays(estimatedEffortDays.value)
  const actualEffort = parseEffortDays(actualEffortDays.value)
  // 評価者: 選択中の ID を常に送信（完了へ変えても保持。UI はレビュー待ち時のみ表示）
  const reviewers = buildReviewersPayload()

  // 完了度は詳細画面で調整。編集時は送らず既存値を保持。
  // 新規作成・ステータス変更時の 完了/未着手 は API 側で完了度を合わせる。
  const payload = {
    title: title.value.trim(),
    description: description.value.trim() || undefined,
    // 親の強制進行中以外は status を送る（許容候補内）
    ...(!statusLocked.value ? { status: status.value } : {}),
    priority: priority.value,
    requirement: requirement.value.trim() || undefined,
    // 親の担当は子孫の和集合（手入力しない）
    ...(scheduleLocked.value
      ? {}
      : {
          assignees,
          assigneeId: primary?.userId,
          assigneeName: primary?.displayName,
        }),
    // 新規かつ非レビュー待ちで未選択なら送らない（空でクリアしない）
    ...(props.task || status.value === 'レビュー待ち' || reviewers.length > 0
      ? { reviewers }
      : {}),
    // 親ノードは予定/実績を送らない（サーバー側でも拒否）
    ...(scheduleLocked.value
      ? {}
      : {
          plannedStartDate: optionalDatePayload(plannedStartDate.value),
          plannedDueDate: optionalDatePayload(plannedDueDate.value),
          actualStartDate: optionalDatePayload(actualStartDate.value),
          actualDueDate: optionalDatePayload(actualDueDate.value),
          ...(plannedEffort !== undefined
            ? { estimatedEffortDays: plannedEffort }
            : {}),
          ...(actualEffort !== undefined ? { actualEffortDays: actualEffort } : {}),
        }),
    // 親: L2 優先、なければ L1。未選択ならルート（編集時は null でクリア）
    parentTaskId: resolvedParentTaskId.value
      ? resolvedParentTaskId.value
      : props.task
        ? null
        : undefined,
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
    :max-width="920"
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
              {{ isEditMode ? '内容を更新' : 'タスクを追加' }}
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
          <!-- 要件 -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-bullseye-arrow</v-icon>
              要件
            </div>
            <div class="field-card field-card--requirement">
              <v-textarea
                v-model="requirement"
                placeholder="依頼内容・ゴール・完了条件など"
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
                placeholder="実装方針、注意点、関連リンクなど"
                rows="4"
                auto-grow
                counter="5000"
                variant="plain"
                density="comfortable"
                class="inner-field"
              />
            </div>
          </section>

          <!-- ステータス / 優先度 / 予定・実績の日付と工数 -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-tune-variant</v-icon>
              ステータス・優先度・スケジュール
            </div>
            <div class="meta-fields">
              <v-select
                v-model="status"
                :items="statusSelectItems"
                label="ステータス"
                hide-details
                variant="outlined"
                density="comfortable"
                :disabled="statusLocked"
                :hint="
                  statusLocked
                    ? '子に「進行中」があるため親は進行中固定'
                    : scheduleLocked
                      ? '子の状態に応じて選択可能な値のみ'
                      : undefined
                "
                :persistent-hint="scheduleLocked"
              />
              <v-select
                v-model="priority"
                :items="priorityOptions"
                label="優先度"
                hide-details
                variant="outlined"
                density="comfortable"
              />
            </div>
            <div class="parent-cascade mt-3">
              <p class="schedule-form-caption mb-2">親タスク（WBS・段階選択）</p>
              <!-- meta-fields と同じ 2 列全幅（status / 優先度と揃える） -->
              <div class="meta-fields parent-cascade-fields">
                <v-select
                  v-model="parentL1Id"
                  :items="parentL1Options"
                  item-title="title"
                  item-value="value"
                  label="第1階層"
                  placeholder="なし（ルートとして作成）"
                  clearable
                  hide-details="auto"
                  variant="outlined"
                  density="comfortable"
                  class="parent-cascade-select"
                  hint="先に第1階層を選ぶと、その下の第2階層を選べます"
                  persistent-hint
                />
                <v-select
                  v-model="parentL2Id"
                  :items="parentL2Options"
                  item-title="title"
                  item-value="value"
                  label="第2階層（任意）"
                  placeholder="未選択 = 第1階層の直下"
                  clearable
                  hide-details="auto"
                  variant="outlined"
                  density="comfortable"
                  class="parent-cascade-select"
                  :disabled="!parentL1Id"
                  :hint="
                    parentL1Id
                      ? parentL2Options.length
                        ? '選択すると第2階層の下に作成（第3階層）'
                        : 'この第1階層に第2階層タスクはありません'
                      : '第1階層を先に選択してください'
                  "
                  persistent-hint
                />
              </div>
            </div>
            <v-alert
              v-if="scheduleLocked"
              type="info"
              variant="tonal"
              density="compact"
              class="mt-4 mb-0"
            >
              子がある親タスク: 予定/実績・進捗・担当は子から集計。優先度・レビュアーは個別設定。ステータスは子の状態に応じた候補から選択（進行中の子があれば固定）。
            </v-alert>
            <template v-else>
              <p class="schedule-form-caption mt-4 mb-2">予定（開始 · 終了 · 工数）</p>
              <div class="schedule-fields">
                <v-text-field
                  v-model="plannedStartDate"
                  label="予定開始日"
                  type="date"
                  hide-details="auto"
                  variant="outlined"
                  density="comfortable"
                  hint="タイムラインの基準日"
                  persistent-hint
                />
                <v-text-field
                  v-model="plannedDueDate"
                  label="予定終了日"
                  type="date"
                  hide-details="auto"
                  variant="outlined"
                  density="comfortable"
                  hint="予定上の終了日"
                  persistent-hint
                />
                <v-text-field
                  v-model="estimatedEffortDays"
                  label="予定工数（人日）"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="例: 2.5"
                  hide-details="auto"
                  variant="outlined"
                  density="comfortable"
                  suffix="人日"
                  hint="タイムライン表示に使用"
                  persistent-hint
                />
              </div>
              <p class="schedule-form-caption mt-4 mb-2">実績（開始 · 終了 · 工数）</p>
              <div class="schedule-fields">
                <v-text-field
                  v-model="actualStartDate"
                  label="実績開始日"
                  type="date"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
                <v-text-field
                  v-model="actualDueDate"
                  label="実績終了日"
                  type="date"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                />
                <v-text-field
                  v-model="actualEffortDays"
                  label="実績工数（人日）"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="例: 3"
                  hide-details
                  variant="outlined"
                  density="comfortable"
                  suffix="人日"
                />
              </div>
            </template>
          </section>

          <!-- 担当者（親は子孫の和集合・編集不可） -->
          <section class="form-section mb-5">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-account-multiple-outline</v-icon>
              担当者（複数可）
              <span v-if="scheduleLocked" class="text-caption font-weight-regular ml-1">
                （子の和集合）
              </span>
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
              :disabled="scheduleLocked"
              hide-details="auto"
              variant="outlined"
              density="comfortable"
              :hint="
                assigneeOptions.length
                  ? 'プロジェクトメンバーから複数選択'
                  : 'メンバーがいません。先にプロジェクトへ追加してください'
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
                      {{ avatarLabelFromName(String(item.title)) }}
                    </span>
                  </v-avatar>
                  {{ item.title }}
                </v-chip>
              </template>
            </v-select>
          </section>

          <!-- レビュアー（レビュー待ちのとき） -->
          <section v-if="showReviewers" class="form-section mb-2">
            <div class="section-label">
              <v-icon size="18" class="mr-1">mdi-account-check-outline</v-icon>
              レビュアー（複数可）
            </div>
            <v-select
              v-model="selectedReviewerIds"
              :items="assigneeOptions"
              item-title="title"
              item-value="value"
              placeholder="レビュアーを選択"
              multiple
              chips
              closable-chips
              clearable
              hide-details="auto"
              variant="outlined"
              density="comfortable"
              :hint="
                assigneeOptions.length
                  ? 'プロジェクトメンバーから選択'
                  : 'メンバーがいません。先にプロジェクトへ追加してください'
              "
              persistent-hint
            >
              <template #chip="{ props: chipProps, item }">
                <v-chip
                  v-bind="chipProps"
                  size="small"
                  color="warning"
                  variant="tonal"
                >
                  <v-avatar start size="20" color="warning">
                    <span class="text-caption text-white" style="font-size: 9px">
                      {{ avatarLabelFromName(String(item.title)) }}
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
          保存
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style>
/* teleported dialog content */
.task-form-dialog.v-overlay__content {
  width: min(920px, calc(100vw - 24px)) !important;
  max-width: min(920px, calc(100vw - 24px)) !important;
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
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
}

.parent-cascade {
  width: 100%;
}

.parent-cascade-fields {
  width: 100%;
  grid-template-columns: 1fr 1fr;
}

.parent-cascade-select {
  width: 100%;
  min-width: 0;
}

.parent-cascade-select :deep(.v-input),
.parent-cascade-select :deep(.v-field) {
  width: 100%;
}

.schedule-form-caption {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.schedule-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 720px) {
  .schedule-fields {
    grid-template-columns: 1fr;
  }
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
