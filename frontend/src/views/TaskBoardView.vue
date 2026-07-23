<script setup lang="ts">
// かんばんビュー
// ドラッグは .drag-handle のみ。カード本体クリックで詳細を 1 回で開く。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import { useDisplayNamesStore } from '@/stores/displayNames'
import { useAuthStore } from '@/stores/auth'
import type { Task, TaskStatus } from '@/types/task'
import { TASK_STATUSES, STATUS_COLORS } from '@/types/task'
import TaskCard from '@/components/task/TaskCard.vue'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import { resolveAssigneeDisplayName, resolveAssigneeLabels } from '@/utils/displayName'
import { prepareTaskForDetail } from '@/utils/kanbanOpen'
import {
  hasChildren,
  matchesKanbanScope,
  type KanbanScopeMode,
} from '@/utils/wbs'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const displayNamesStore = useDisplayNamesStore()
const authStore = useAuthStore()
const uiStore = useUiStore()

const projectId = computed(() => route.params.projectId as string)

const showDetail = ref(false)
const showCreateForm = ref(false)
const defaultStatus = ref<TaskStatus>('未着手')

const filterAssignee = ref<string | null>(null)
const filterPriority = ref<string | null>(null)
/** 自分が評価者のレビュー待ちだけ表示 */
const filterMyReview = ref(false)

/**
 * かんばん表示範囲
 * 1. leaf  … 最小単位（既定）
 * 2. level … 階層指定（第1〜第3）
 * 3. all   … 全タスク
 */
const scopeMode = ref<KanbanScopeMode>('leaf')
/** scopeMode === 'level' のとき 1 | 2 | 3 */
const scopeLevel = ref<1 | 2 | 3>(1)

const scopeModeItems = [
  { value: 'leaf' as const, title: '最小単位', subtitle: '子のないタスクのみ（既定）' },
  { value: 'level' as const, title: '階層', subtitle: '第1〜第3層から選択' },
  { value: 'all' as const, title: 'すべて', subtitle: '全タスクを表示' },
]

const scopeLevelItems = [
  { value: 1 as const, title: '第1層' },
  { value: 2 as const, title: '第2層' },
  { value: 3 as const, title: '第3層' },
]

const scopeHint = computed(() => {
  if (scopeMode.value === 'leaf') {
    return '子タスクのない最小単位のみ表示しています。'
  }
  if (scopeMode.value === 'level') {
    return `WBS の第${scopeLevel.value}階層のタスクのみ表示しています。`
  }
  return 'すべてのタスクを表示しています（親・子の両方）。'
})

const myUserId = computed(() => authStore.currentUser?.sub ?? '')

function isMyReviewTask(task: Task): boolean {
  if (task.status !== 'レビュー待ち') return false
  const uid = myUserId.value
  if (!uid) return false
  return (task.reviewers ?? []).some((r) => r.userId === uid)
}

const myReviewCount = computed(
  () => tasksStore.activeTasks.filter((t) => isMyReviewTask(t)).length,
)

/**
 * ストア＋フィルタから各ステータス列のタスク配列を構築。
 * vuedraggable は list を直接 splice するため、computed をそのまま渡さず
 * ローカルの reactive 配列に同期する（途中位置へのドロップも安定させる）。
 */
function buildFilteredByStatus(): Record<TaskStatus, Task[]> {
  const all = tasksStore.tasks
  const result = {} as Record<TaskStatus, Task[]>
  for (const status of TASK_STATUSES) {
    result[status] = all.filter((task) => {
      if (task.isDeleted || task.status !== status) return false
      if (
        !matchesKanbanScope(task, all, scopeMode.value, scopeLevel.value)
      ) {
        return false
      }
      if (filterMyReview.value && !isMyReviewTask(task)) return false
      if (
        filterAssignee.value &&
        !resolveAssigneeLabels(task).includes(filterAssignee.value)
      ) {
        return false
      }
      if (filterPriority.value && task.priority !== filterPriority.value) {
        return false
      }
      return true
    })
  }
  return result
}

/** 各列の表示用リスト（draggable が直接 mutate する） */
const columnLists = ref<Record<TaskStatus, Task[]>>(buildFilteredByStatus())

/** ドラッグ中は store 同期で list を差し替えない（ドロップ位置判定を壊さない） */
const isDragging = ref(false)

function syncColumnListsFromStore() {
  if (isDragging.value) return
  columnLists.value = buildFilteredByStatus()
}

watch(
  () => [
    tasksStore.tasks,
    scopeMode.value,
    scopeLevel.value,
    filterMyReview.value,
    filterAssignee.value,
    filterPriority.value,
    myUserId.value,
  ],
  () => {
    syncColumnListsFromStore()
  },
  { deep: true },
)

function onDragStart() {
  isDragging.value = true
}

function onDragEnd() {
  isDragging.value = false
  // 楽観更新後の最終形に揃える（失敗ロールバック時もここで復帰）
  syncColumnListsFromStore()
}

/**
 * 他列へ追加されたときだけ status を更新。
 * 列内の並べ替え（moved）は現状永続化しない。
 * 先頭以外（カードの間・末尾）へのドロップでも added が発火する。
 * 親（子あり）は集計対象のためかんばんからの status 変更を拒否する。
 */
async function handleDragChange(
  event: {
    added?: { element: Task; newIndex: number }
    removed?: { element: Task; oldIndex: number }
    moved?: { element: Task; newIndex: number; oldIndex: number }
  },
  targetStatus: TaskStatus,
) {
  if (!event.added) return
  const task = event.added.element
  if (task.status === targetStatus) return

  // 親タスク: ドロップを取り消し（列リストをストアから再同期）
  if (hasChildren(task, tasksStore.tasks)) {
    uiStore.showWarning(
      '子タスクがある親は、かんばんからステータスを変更できません（子から集計されます）',
    )
    isDragging.value = false
    syncColumnListsFromStore()
    return
  }

  // 楽観的に element の status も揃えておく（直後の再描画で列をまたがない）
  task.status = targetStatus
  await tasksStore.updateTaskStatus(task.taskId, targetStatus)
}

function openCreateForm(status: TaskStatus) {
  defaultStatus.value = status
  showCreateForm.value = true
}

/**
 * タスク詳細を開く（親ラッパー / カードのどちらからでも呼べる）
 */
function openTaskDetail(task: Task) {
  const prepared = prepareTaskForDetail(task, resolveAssigneeDisplayName)
  if (!prepared) {
    console.warn('[TaskBoard] openTaskDetail: invalid task', task)
    return
  }

  tasksStore.currentTask = prepared
  // dialog は navigation-drawer と違い、v-main 内でも確実に表示される
  showDetail.value = true

  if (route.query.taskId !== prepared.taskId) {
    void router
      .replace({
        name: 'task-board',
        params: { projectId: projectId.value },
        query: { ...route.query, taskId: prepared.taskId },
      })
      .catch(() => {
        /* ignore navigation abort */
      })
  }
}

/**
 * リスト項目クリック（ハンドル以外）
 * 子コンポーネントの emit が届かない場合のフォールバックも兼ねる
 */
function onItemClick(task: Task, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.drag-handle')) return
  openTaskDetail(task)
}

async function openTaskFromQuery(): Promise<void> {
  const raw = route.query.taskId
  const taskId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : ''
  if (!taskId) return

  let task = tasksStore.tasks.find((t) => t.taskId === taskId && !t.isDeleted)
  if (!task) {
    try {
      await tasksStore.fetchTask(taskId)
      task = tasksStore.currentTask ?? undefined
    } catch {
      return
    }
  }
  if (!task || task.projectId !== projectId.value) return
  openTaskDetail(task)
}

function resetFilters() {
  filterAssignee.value = null
  filterPriority.value = null
  filterMyReview.value = false
}

function toggleMyReviewFilter() {
  filterMyReview.value = !filterMyReview.value
  // URL と同期（ダッシュボードからの遷移と揃える）
  const q = { ...route.query }
  if (filterMyReview.value) {
    q.myReview = '1'
  } else {
    delete q.myReview
  }
  void router.replace({ name: 'task-board', params: { projectId: projectId.value }, query: q }).catch(() => {})
}

function syncMyReviewFromQuery() {
  filterMyReview.value =
    route.query.myReview === '1' || route.query.myReview === 'true'
}

watch(showDetail, (open) => {
  if (open) return
  if (!route.query.taskId) return
  const nextQuery = { ...route.query }
  delete nextQuery.taskId
  void router
    .replace({
      name: 'task-board',
      params: { projectId: projectId.value },
      query: nextQuery,
    })
    .catch(() => {
      /* ignore */
    })
})

/** 初回のみスケルトン（キャッシュがあればすぐボードを出す） */
const showInitialSkeleton = computed(
  () =>
    tasksStore.isLoading &&
    !tasksStore.hasDataForCurrentProject &&
    tasksStore.currentProjectId === projectId.value,
)

/**
 * SWR: キャッシュを先に表示し、必要なら裏で再取得
 * projectId 変更時も watch で呼び直す
 */
async function loadBoard(): Promise<void> {
  const id = projectId.value
  if (!id) return
  syncMyReviewFromQuery()
  await Promise.all([
    projectsStore.ensureProject(id),
    tasksStore.ensureTasks(id),
  ])
  // 表示名はキャッシュ適用後に軽く同期（裏取り時は ensure 内でも実施）
  if (projectsStore.currentProject) {
    displayNamesStore.ingestProject(projectsStore.currentProject)
  }
  displayNamesStore.ingestTasks(tasksStore.tasks)
  await openTaskFromQuery()
}

onMounted(() => {
  void loadBoard()
})

watch(projectId, () => {
  void loadBoard()
})

watch(
  () => route.query.myReview,
  () => {
    syncMyReviewFromQuery()
  },
)
</script>

<template>
  <v-container fluid class="py-4 px-4">
    <div class="d-flex align-center flex-wrap gap-3 mb-3">
      <h1 class="text-h6 font-weight-bold">
        {{ projectsStore.currentProject?.name ?? 'かんばんビュー' }}
      </h1>
      <v-progress-circular
        v-if="tasksStore.isRefreshing || projectsStore.isRefreshing"
        indeterminate
        size="18"
        width="2"
        color="primary"
        class="ml-2"
        title="最新データを確認中"
      />
      <v-spacer />
      <v-btn
        :variant="filterMyReview ? 'flat' : 'tonal'"
        :color="filterMyReview ? 'warning' : undefined"
        size="small"
        prepend-icon="mdi-clipboard-check-outline"
        class="mr-1"
        @click="toggleMyReviewFilter"
      >
        要レビュー
        <v-chip
          v-if="myReviewCount > 0"
          size="x-small"
          :color="filterMyReview ? 'white' : 'warning'"
          :variant="filterMyReview ? 'elevated' : 'flat'"
          class="ml-2"
          label
        >
          {{ myReviewCount }}
        </v-chip>
      </v-btn>
      <TaskFilters
        v-model:assignee="filterAssignee"
        v-model:priority="filterPriority"
        :tasks="tasksStore.activeTasks"
        @reset="resetFilters"
      />
    </div>

    <!-- 表示範囲: 最小単位 / 階層 / すべて -->
    <div class="scope-bar d-flex align-center flex-wrap ga-3 mb-3">
      <span class="text-caption text-medium-emphasis font-weight-medium">表示</span>
      <v-btn-toggle
        v-model="scopeMode"
        mandatory
        density="comfortable"
        color="primary"
        rounded="lg"
        divided
        class="scope-toggle"
      >
        <v-btn
          v-for="opt in scopeModeItems"
          :key="opt.value"
          :value="opt.value"
          size="small"
        >
          {{ opt.title }}
        </v-btn>
      </v-btn-toggle>

      <v-btn-toggle
        v-if="scopeMode === 'level'"
        v-model="scopeLevel"
        mandatory
        density="comfortable"
        color="secondary"
        rounded="lg"
        divided
        class="scope-level-toggle"
      >
        <v-btn
          v-for="opt in scopeLevelItems"
          :key="opt.value"
          :value="opt.value"
          size="small"
        >
          {{ opt.title }}
        </v-btn>
      </v-btn-toggle>

      <span class="text-caption text-medium-emphasis scope-hint">
        {{ scopeHint }}
      </span>
    </div>

    <v-alert
      v-if="filterMyReview"
      type="warning"
      variant="tonal"
      density="compact"
      class="mb-3"
      closable
      @click:close="toggleMyReviewFilter"
    >
      あなたがレビュアーの「レビュー待ち」タスクのみ表示中（オレンジ枠）
    </v-alert>

    <v-row v-if="showInitialSkeleton">
      <v-col v-for="i in 5" :key="i" cols="12" sm="6" md="4" lg="2">
        <v-skeleton-loader type="card, card, card" />
      </v-col>
    </v-row>

    <div
      v-else
      class="board-scroll d-flex gap-3 overflow-x-auto pb-4"
    >
      <div
        v-for="status in TASK_STATUSES"
        :key="status"
        class="flex-shrink-0 board-col d-flex flex-column"
        :class="{ 'board-col--review-focus': filterMyReview && status === 'レビュー待ち' }"
      >
        <div class="d-flex align-center mb-3 px-1 flex-shrink-0">
          <v-chip :color="STATUS_COLORS[status]" size="small" label class="mr-2">
            {{ status }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">
            {{ columnLists[status].length }} 件
          </span>
          <v-spacer />
          <v-btn
            icon="mdi-plus"
            variant="text"
            size="x-small"
            density="compact"
            @click="openCreateForm(status)"
          />
        </div>

        <!--
          列全体をドロップ対象にする（先頭以外・末尾の空き領域にも落とせる）。
          list はローカル columnLists を直接 mutate。
        -->
        <draggable
          :list="columnLists[status]"
          :group="{ name: 'tasks', put: true, pull: true }"
          item-key="taskId"
          handle=".drag-handle"
          ghost-class="ghost-card"
          chosen-class="chosen-card"
          drag-class="drag-card"
          :animation="200"
          :empty-insert-threshold="80"
          :swap-threshold="0.65"
          :invert-swap="true"
          class="task-column flex-grow-1"
          @start="onDragStart"
          @end="onDragEnd"
          @change="handleDragChange($event, status)"
        >
          <template #item="{ element: task }">
            <div class="task-column-item mb-2" @click="onItemClick(task, $event)">
              <TaskCard
                :task="task"
                :needs-my-review="isMyReviewTask(task)"
                @open="openTaskDetail"
              />
            </div>
          </template>
        </draggable>
      </div>
    </div>

    <TaskDetail v-model="showDetail" :project-id="projectId" />

    <TaskForm
      v-model="showCreateForm"
      :project-id="projectId"
      :default-status="defaultStatus"
    />
  </v-container>
</template>

<style scoped>
.board-scroll {
  /* ヘッダー・フィルタ分を除いた高さ。列を縦いっぱいに伸ばしてドロップ域を確保 */
  min-height: calc(100vh - 200px);
  align-items: stretch;
}

.board-col {
  width: 280px;
  min-width: 280px;
  /* カードが少なくても列全体をドロップ可能にする */
  min-height: calc(100vh - 200px);
}

.ghost-card {
  opacity: 0.4;
  background: rgb(var(--v-theme-primary), 0.1);
  border: 2px dashed rgb(var(--v-theme-primary));
  border-radius: 8px;
}

.drag-card {
  transform: rotate(2deg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
}

.task-column {
  padding: 4px;
  /* 列の残り高さをすべてドロップ領域に（末尾の空きにも落とせる） */
  min-height: 160px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
  /* Sortable が子の隙間を判定しやすいよう */
  box-sizing: border-box;
}

.task-column-item {
  /* ドロップ判定用にマージンを要素外ではなく gap 相当で確保 */
  cursor: default;
}

.board-col--review-focus {
  background: rgba(var(--v-theme-warning), 0.06);
  border-radius: 12px;
  padding: 8px 6px 12px;
  outline: 1px solid rgba(var(--v-theme-warning), 0.35);
}

.scope-bar {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.scope-toggle :deep(.v-btn),
.scope-level-toggle :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0.01em;
}

.scope-hint {
  flex: 1 1 160px;
  min-width: 0;
}
</style>
