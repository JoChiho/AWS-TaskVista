<script setup lang="ts">
// テーブルリストビューページ
// Vuetify v-data-table でタスクをソート・フィルター・ページング表示する
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import type { Task, TaskPriority, TaskStatus } from '@/types/task'
import {
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  TASK_STATUSES,
  normalizeCompletion,
  completionColor,
  isPlannedDueOverdue,
} from '@/types/task'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import {
  formatAssigneeList,
  formatAssigneeSurnames,
  formatReviewerList,
  resolveAssigneeLabels,
} from '@/utils/displayName'
import {
  compareWbsCode,
  depthOfTask,
  displaySchedule,
  flattenVisibleTree,
  hasChildren,
  type WbsSortOrder,
} from '@/utils/wbs'

type TableSortKey =
  | 'wbsCode'
  | 'status'
  | 'priority'
  | 'plannedStartDate'
  | 'plannedDueDate'
  | 'actualStartDate'
  | 'actualDueDate'

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
}

const STATUS_RANK: Record<TaskStatus, number> = Object.fromEntries(
  TASK_STATUSES.map((s, i) => [s, i]),
) as Record<TaskStatus, number>

const route = useRoute()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// プロジェクト ID をルートパラメーターから取得する
const projectId = computed(() => route.params.projectId as string)

// タスク詳細ドロワーの表示状態
const showDetail = ref(false)
// タスク作成ダイアログの表示状態
const showCreateForm = ref(false)
/** テーブル + から作成するときの親タスク ID */
const createParentTaskId = ref<string | null>(null)

/** 第1・第2層のみ子を追加可能（深さ 0 / 1 → 最大3層） */
function canAddChild(task: Task): boolean {
  return depthOfTask(task, tasksStore.activeTasks) <= 1
}

function openCreateRoot() {
  createParentTaskId.value = null
  showCreateForm.value = true
}

function openCreateChild(parent: Task, e?: Event) {
  e?.stopPropagation()
  e?.preventDefault()
  createParentTaskId.value = parent.taskId
  // ツリー表示中は親を展開しておく
  if (isWbsTreeSort.value && !expandedIds.value.has(parent.taskId)) {
    const next = new Set(expandedIds.value)
    next.add(parent.taskId)
    expandedIds.value = next
  }
  showCreateForm.value = true
}

function onCreateFormSaved() {
  // 親の下に作った場合は展開を維持
  if (createParentTaskId.value) {
    const next = new Set(expandedIds.value)
    next.add(createParentTaskId.value)
    expandedIds.value = next
  }
  createParentTaskId.value = null
}

watch(showCreateForm, (open) => {
  if (!open) {
    // キャンセル時も親指定をクリア（次回「タスクを追加」に残さない）
    // saved 後は onCreateFormSaved で既に null
    queueMicrotask(() => {
      if (!showCreateForm.value) createParentTaskId.value = null
    })
  }
})

// フィルター条件
const filterAssignee = ref<string | null>(null)
const filterPriority = ref<string | null>(null)
const filterStatus = ref<string | null>(null)

// タスク名検索文字列
const searchText = ref('')
// デバウンス用の内部検索テキスト
const debouncedSearch = ref('')
// デバウンスタイマー
let debounceTimer: ReturnType<typeof setTimeout>

/** ツリー展開中の親 taskId */
const expandedIds = ref<Set<string>>(new Set())

/**
 * ソート: 既定は WBS 昇順（ツリー表示）
 * 他列ソート時はフラット一覧（親子展開は WBS 時のみ）
 */
const sortKey = ref<TableSortKey>('wbsCode')
const sortOrder = ref<'asc' | 'desc'>('asc')

/** Vuetify sort-by と同期 */
const sortBy = computed({
  get: () => [{ key: sortKey.value, order: sortOrder.value }],
  set: (v: Array<{ key: string; order?: 'asc' | 'desc' }>) => {
    const first = v?.[0]
    if (!first?.key) return
    const key = first.key as TableSortKey
    const allowed: TableSortKey[] = [
      'wbsCode',
      'status',
      'priority',
      'plannedStartDate',
      'plannedDueDate',
      'actualStartDate',
      'actualDueDate',
    ]
    if (!allowed.includes(key)) return
    sortKey.value = key
    sortOrder.value = first.order === 'desc' ? 'desc' : 'asc'
    tablePage.value = 1
  },
})

const isWbsTreeSort = computed(() => sortKey.value === 'wbsCode')

/**
 * 実ソートは filteredTasks 側で実施。
 * Vuetify 内部ソートを無効化しつつヘッダーの昇降アイコンは sort-by で表示する。
 */
const preserveOrderSort: Record<string, (a: unknown, b: unknown) => number> = {
  wbsCode: () => 0,
  status: () => 0,
  priority: () => 0,
  plannedStartDate: () => 0,
  plannedDueDate: () => 0,
  actualStartDate: () => 0,
  actualDueDate: () => 0,
}

// 検索入力に 300ms のデバウンスを適用する
watch(searchText, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val
  }, 300)
})

/** 親子展開があるため 1 ページは固定 10 件（見やすさ優先） */
const itemsPerPage = 10
/** フッターの件数セレクトは出さず、ページ番号のみ */
const tablePage = ref(1)

/**
 * テーブルのカラム定義
 * 要件列は日付閲覧時に邪魔になるため非表示。タスク名は広め。
 * ソート可能: WBS / ステータス / 優先度 / 予定・実績の開始・終了
 */
const headers = [
  {
    title: 'WBS',
    key: 'wbsCode',
    sortable: true,
    minWidth: '48px',
    width: '52px',
  },
  {
    title: 'タスク名',
    key: 'title',
    sortable: false,
    minWidth: '280px',
    width: '320px',
  },
  {
    title: 'ステータス',
    key: 'status',
    sortable: true,
    minWidth: '130px',
    width: '130px',
    cellProps: { class: 'col-chip' },
    headerProps: { class: 'col-chip' },
  },
  {
    title: '進捗',
    key: 'completionPercent',
    sortable: false,
    minWidth: '100px',
    width: '110px',
  },
  {
    title: '担当者',
    key: 'assigneeName',
    sortable: false,
    minWidth: '120px',
    width: '140px',
  },
  {
    title: 'レビュアー',
    key: 'reviewers',
    sortable: false,
    minWidth: '100px',
    width: '120px',
  },
  {
    title: '優先度',
    key: 'priority',
    sortable: true,
    minWidth: '90px',
    width: '90px',
    cellProps: { class: 'col-chip' },
    headerProps: { class: 'col-chip' },
  },
  {
    title: '予定開始',
    key: 'plannedStartDate',
    sortable: true,
    minWidth: '118px',
    width: '118px',
    cellProps: { class: 'col-date' },
    headerProps: { class: 'col-date' },
  },
  {
    title: '予定終了',
    key: 'plannedDueDate',
    sortable: true,
    minWidth: '118px',
    width: '118px',
    cellProps: { class: 'col-date' },
    headerProps: { class: 'col-date' },
  },
  {
    title: '実績開始',
    key: 'actualStartDate',
    sortable: true,
    minWidth: '118px',
    width: '118px',
    cellProps: { class: 'col-date' },
    headerProps: { class: 'col-date' },
  },
  {
    title: '実績終了',
    key: 'actualDueDate',
    sortable: true,
    minWidth: '118px',
    width: '118px',
    cellProps: { class: 'col-date' },
    headerProps: { class: 'col-date' },
  },
  {
    title: '予定工数',
    key: 'estimatedEffortDays',
    sortable: false,
    minWidth: '90px',
    width: '90px',
  },
  {
    title: '実績工数',
    key: 'actualEffortDays',
    sortable: false,
    minWidth: '90px',
    width: '90px',
  },
]

function matchesFilters(task: Task): boolean {
  if (filterStatus.value && task.status !== filterStatus.value) return false
  if (
    filterAssignee.value &&
    !resolveAssigneeLabels(task).includes(filterAssignee.value)
  ) {
    return false
  }
  if (filterPriority.value && task.priority !== filterPriority.value) return false
  if (
    debouncedSearch.value &&
    !task.title.toLowerCase().includes(debouncedSearch.value.toLowerCase())
  ) {
    return false
  }
  return true
}

/**
 * フィルター適用後の全タスク
 * 検索・フィルタ中はツリーをフラット表示（該当行を見落とさない）
 */
const matchedTasks = computed(() =>
  tasksStore.activeTasks.filter((t) => matchesFilters(t)),
)

const isFilterActive = computed(
  () =>
    !!filterStatus.value ||
    !!filterAssignee.value ||
    !!filterPriority.value ||
    !!debouncedSearch.value.trim(),
)

function compareDateField(a?: string | null, b?: string | null): number {
  const aa = a?.slice(0, 10) || ''
  const bb = b?.slice(0, 10) || ''
  if (!aa && !bb) return 0
  if (!aa) return 1 // 未設定は末尾
  if (!bb) return -1
  return aa.localeCompare(bb)
}

function compareTasksByKey(a: Task, b: Task, key: TableSortKey): number {
  const sa = displaySchedule(a)
  const sb = displaySchedule(b)
  switch (key) {
    case 'wbsCode':
      return compareWbsCode(a.wbsCode, b.wbsCode)
    case 'status': {
      const statusA =
        sa.isRollup && a.rollup?.status ? a.rollup.status : a.status
      const statusB =
        sb.isRollup && b.rollup?.status ? b.rollup.status : b.status
      return (STATUS_RANK[statusA] ?? 99) - (STATUS_RANK[statusB] ?? 99)
    }
    case 'priority':
      return (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0)
    case 'plannedStartDate':
      return compareDateField(sa.plannedStartDate, sb.plannedStartDate)
    case 'plannedDueDate':
      return compareDateField(sa.plannedDueDate, sb.plannedDueDate)
    case 'actualStartDate':
      return compareDateField(sa.actualStartDate, sb.actualStartDate)
    case 'actualDueDate':
      return compareDateField(sa.actualDueDate, sb.actualDueDate)
    default:
      return 0
  }
}

/**
 * 表示行:
 * - WBS ソート: ルート + 展開子のツリー（兄弟は WBS 順）
 * - 他列ソート: フラット一覧（フィルタ対象）をその列で並べ替え
 */
const filteredTasks = computed<Task[]>(() => {
  const all = tasksStore.activeTasks
  const order = sortOrder.value
  const key = sortKey.value
  const wbsOrder: WbsSortOrder = order

  if (key === 'wbsCode') {
    if (isFilterActive.value) {
      const need = new Set(matchedTasks.value.map((t) => t.taskId))
      for (const t of matchedTasks.value) {
        let p = t.parentTaskId
        const byId = new Map(all.map((x) => [x.taskId, x]))
        while (p) {
          need.add(p)
          p = byId.get(p)?.parentTaskId
        }
      }
      const expandAll = new Set(
        [...need].filter((id) => {
          const t = all.find((x) => x.taskId === id)
          return t && hasChildren(t, all)
        }),
      )
      return flattenVisibleTree(
        all.filter((t) => need.has(t.taskId)),
        expandAll,
        wbsOrder,
      )
    }
    return flattenVisibleTree(all, expandedIds.value, wbsOrder)
  }

  // 非 WBS: フラット + 列ソート
  const base = isFilterActive.value ? matchedTasks.value : all
  const sorted = [...base].sort((a, b) => {
    const c = compareTasksByKey(a, b, key)
    return order === 'asc' ? c : -c
  })
  return sorted
})

const tablePageCount = computed(() =>
  Math.max(1, Math.ceil(filteredTasks.value.length / itemsPerPage)),
)

// フィルタ変更時は 1 ページ目へ
watch(
  () => [
    filterStatus.value,
    filterAssignee.value,
    filterPriority.value,
    debouncedSearch.value,
  ],
  () => {
    tablePage.value = 1
  },
)

function toggleExpand(taskId: string, e?: Event) {
  e?.stopPropagation()
  e?.preventDefault()
  const next = new Set(expandedIds.value)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  expandedIds.value = next
}

function isExpanded(taskId: string): boolean {
  return expandedIds.value.has(taskId)
}

function rowHasChildren(task: Task): boolean {
  return hasChildren(task, tasksStore.activeTasks)
}

function sched(task: Task) {
  return displaySchedule(task)
}

function isPlannedDueOverdueRow(task: Task): boolean {
  const s = sched(task)
  const status =
    s.isRollup && task.rollup?.status ? task.rollup.status : task.status
  return isPlannedDueOverdue(s.plannedDueDate, status)
}

/** 行クリックでタスク詳細を開く（展開ボタンは stop 済み） */
function onRowClick(_event: Event, row: { item: Task }) {
  tasksStore.currentTask = row.item
  showDetail.value = true
}

/**
 * テーブル用の短い日付（例: 2026.07.15）
 * 詳細画面では TaskDetail 側の日本語長形式を使う
 */
function formatTableDate(dateStr?: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

/** フィルターをリセットする */
function resetFilters() {
  filterAssignee.value = null
  filterPriority.value = null
  filterStatus.value = null
  searchText.value = ''
}

/** 初回のみスケルトン（キャッシュがあればテーブルをすぐ出す） */
const showInitialSkeleton = computed(
  () =>
    tasksStore.isLoading &&
    !tasksStore.hasDataForCurrentProject &&
    tasksStore.currentProjectId === projectId.value,
)

/** SWR: キャッシュ優先、必要時のみ裏で再取得 */
async function loadTable(): Promise<void> {
  const id = projectId.value
  if (!id) return
  await Promise.all([
    projectsStore.ensureProject(id),
    tasksStore.ensureTasks(id),
  ])
}

onMounted(() => {
  void loadTable()
})

watch(projectId, () => {
  void loadTable()
})
</script>

<template>
  <v-container fluid class="py-4">
    <!-- ページヘッダー -->
    <div class="d-flex align-center flex-wrap gap-3 mb-4">
      <h1 class="text-h6 font-weight-bold">
        {{ projectsStore.currentProject?.name ?? 'テーブルビュー' }}
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
        color="primary"
        prepend-icon="mdi-plus"
        size="small"
        @click="openCreateRoot"
      >
        タスクを追加
      </v-btn>
    </div>

    <!-- 検索とフィルターエリア -->
    <v-row class="mb-4" dense align="center">
      <v-col cols="12" md="4">
        <v-text-field
          v-model="searchText"
          prepend-inner-icon="mdi-magnify"
          placeholder="タスク名で検索"
          clearable
          hide-details
          density="compact"
        />
      </v-col>
      <v-col cols="12" md="8">
        <TaskFilters
          v-model:assignee="filterAssignee"
          v-model:priority="filterPriority"
          v-model:status="filterStatus"
          :tasks="tasksStore.activeTasks"
          show-status-filter
          @reset="resetFilters"
        />
      </v-col>
    </v-row>
    <p class="text-caption text-medium-emphasis mb-2">
      列見出しをクリックで並び替え（既定: WBS 昇順）。
      <template v-if="isWbsTreeSort">
        WBS 順のとき親子ツリーを展開表示します。
      </template>
      <template v-else>
        他列ソート時はフラット一覧です。
      </template>
    </p>

    <!-- 初回のみスケルトン（再入場時はキャッシュを即表示） -->
    <v-skeleton-loader v-if="showInitialSkeleton" type="table" />

    <!-- タスクテーブル -->
    <v-data-table
      v-else
      v-model:page="tablePage"
      v-model:sort-by="sortBy"
      :headers="headers"
      :items="filteredTasks"
      :items-per-page="itemsPerPage"
      :custom-key-sort="preserveOrderSort"
      must-sort
      hide-default-footer
      hover
      density="comfortable"
      class="elevation-1 rounded-lg task-table"
      no-data-text="タスクが見つかりません"
      @click:row="onRowClick"
    >
      <!-- WBS 番号 -->
      <template #[`item.wbsCode`]="{ item }">
        <span class="text-caption font-weight-bold text-medium-emphasis cell-wbs">
          {{ item.wbsCode || '—' }}
        </span>
      </template>

      <!-- タスク名：左=展開 / 中央=名前 / 右端=子追加（1・2層のみ） -->
      <template #[`item.title`]="{ item }">
        <div
          class="title-cell"
          :style="{
            paddingLeft: isWbsTreeSort
              ? `${depthOfTask(item, tasksStore.activeTasks) * 16}px`
              : '0',
          }"
        >
          <div class="title-cell-main">
            <template v-if="isWbsTreeSort">
              <button
                v-if="rowHasChildren(item)"
                type="button"
                class="expand-btn"
                :title="isExpanded(item.taskId) ? '折りたたむ' : '子タスクを表示'"
                :aria-expanded="isExpanded(item.taskId)"
                @click="toggleExpand(item.taskId, $event)"
              >
                <v-icon size="18">
                  {{
                    isExpanded(item.taskId)
                      ? 'mdi-chevron-down'
                      : 'mdi-chevron-right'
                  }}
                </v-icon>
              </button>
              <span v-else class="expand-spacer" aria-hidden="true" />
            </template>
            <span class="text-body-2 font-weight-medium cell-main title-text">
              {{ item.title }}
            </span>
          </div>
          <button
            v-if="canAddChild(item)"
            type="button"
            class="add-child-btn"
            title="このタスクの下に子タスクを追加"
            @click="openCreateChild(item, $event)"
          >
            <v-icon size="18">mdi-plus</v-icon>
          </button>
        </div>
      </template>

      <!-- ステータス（親は集計ステータス） -->
      <template #[`item.status`]="{ item }">
        <div class="cell-chip">
          <v-chip
            :color="
              STATUS_COLORS[
                sched(item).isRollup && item.rollup?.status
                  ? item.rollup.status
                  : item.status
              ]
            "
            size="small"
            label
            variant="tonal"
            class="chip-fixed"
          >
            {{
              sched(item).isRollup && item.rollup?.status
                ? item.rollup.status
                : item.status
            }}
          </v-chip>
        </div>
      </template>

      <!-- 優先度カラム -->
      <template #[`item.priority`]="{ item }">
        <div class="cell-chip">
          <v-chip
            :color="PRIORITY_COLORS[item.priority]"
            size="small"
            label
            variant="tonal"
            class="chip-fixed"
          >
            {{ PRIORITY_LABELS[item.priority] }}
          </v-chip>
        </div>
      </template>

      <!-- 予定開始日（親は集計） -->
      <template #[`item.plannedStartDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(sched(item).plannedStartDate) }}
        </span>
      </template>

      <!-- 予定終了日（完了・レビュー待ち・保留は超過ハイライトなし） -->
      <template #[`item.plannedDueDate`]="{ item }">
        <span
          class="text-body-2 cell-date"
          :class="{
            'text-error': isPlannedDueOverdueRow(item),
          }"
        >
          {{ formatTableDate(sched(item).plannedDueDate) }}
        </span>
      </template>

      <!-- 実績開始日 -->
      <template #[`item.actualStartDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(sched(item).actualStartDate) }}
        </span>
      </template>

      <!-- 実績終了日 -->
      <template #[`item.actualDueDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(sched(item).actualDueDate) }}
        </span>
      </template>

      <!-- 予定工数 -->
      <template #[`item.estimatedEffortDays`]="{ item }">
        <span class="text-body-2 cell-date">
          {{
            sched(item).estimatedEffortDays != null
              ? `${sched(item).estimatedEffortDays} 人日`
              : '—'
          }}
        </span>
      </template>

      <!-- 実績工数 -->
      <template #[`item.actualEffortDays`]="{ item }">
        <span class="text-body-2 cell-date">
          {{
            sched(item).actualEffortDays != null
              ? `${sched(item).actualEffortDays} 人日`
              : '—'
          }}
        </span>
      </template>

      <!-- 進捗（親は子から集計） -->
      <template #[`item.completionPercent`]="{ item }">
        <div class="d-flex align-center ga-1" style="min-width: 88px">
          <v-progress-linear
            :model-value="normalizeCompletion(sched(item).completionPercent)"
            :color="
              completionColor(normalizeCompletion(sched(item).completionPercent))
            "
            height="6"
            rounded
            style="flex: 1; min-width: 40px"
          />
          <span class="text-caption font-weight-medium" style="width: 32px">
            {{ normalizeCompletion(sched(item).completionPercent) }}%
          </span>
        </div>
      </template>

      <!-- 担当者カラム（姓のみ・複数でも1行を保つ） -->
      <template #[`item.assigneeName`]="{ item }">
        <span
          class="text-body-2 text-no-wrap text-truncate d-inline-block"
          style="max-width: 100%"
          :title="formatAssigneeList(item) || undefined"
        >
          {{ formatAssigneeSurnames(item) || '—' }}
        </span>
      </template>

      <template #[`item.reviewers`]="{ item }">
        <span
          class="text-body-2 text-no-wrap text-truncate d-inline-block"
          style="max-width: 100%"
          :title="formatReviewerList(item) || undefined"
        >
          {{
            formatReviewerList(item) ||
            (item.status === '完了' || item.status === 'レビュー待ち' ? 'なし' : '—')
          }}
        </span>
      </template>
    </v-data-table>

    <!-- 件数セレクト無し・ページ送りのみ（10 件固定・1 ページ時も表示） -->
    <div
      v-if="!showInitialSkeleton"
      class="table-pagination d-flex align-center justify-center ga-3 py-3"
    >
      <span class="text-caption text-medium-emphasis">
        {{ tablePage }} / {{ tablePageCount }} ページ
      </span>
      <v-pagination
        v-model="tablePage"
        :length="tablePageCount"
        density="comfortable"
        total-visible="7"
        rounded
      />
    </div>

    <!-- タスク詳細サイドドロワー -->
    <TaskDetail
      v-model="showDetail"
      :project-id="projectId"
    />

    <!-- タスク作成ダイアログ（+ からは親を自動設定） -->
    <TaskForm
      v-model="showCreateForm"
      :project-id="projectId"
      :default-parent-task-id="createParentTaskId"
      @saved="onCreateFormSaved"
    />
  </v-container>
</template>

<style scoped>
/* 本文列: タスク名・要件を読みやすく（横スクロール前提で幅を確保） */
.task-table :deep(th),
.task-table :deep(td) {
  vertical-align: middle;
  padding-left: 12px !important;
  padding-right: 12px !important;
}

.task-table :deep(th:nth-child(1)),
.task-table :deep(td:nth-child(1)) {
  min-width: 48px;
  max-width: 56px;
  width: 52px;
  padding-left: 6px !important;
  padding-right: 4px !important;
}

.task-table :deep(th:nth-child(1) .v-data-table-header__content) {
  flex-wrap: nowrap;
  gap: 0;
}

.task-table :deep(th:nth-child(2)),
.task-table :deep(td:nth-child(2)) {
  min-width: 280px;
  max-width: 360px;
}

/* ステータス / 優先度: chip が隣セルに食い込まない */
.task-table :deep(th.col-chip),
.task-table :deep(td.col-chip) {
  white-space: nowrap !important;
  overflow: hidden;
  box-sizing: border-box;
}

/* 日付列ヘッダー: ソートアイコン込みで 1 行に収める */
.task-table :deep(th.col-date),
.task-table :deep(td.col-date) {
  white-space: nowrap !important;
  box-sizing: border-box;
  padding-left: 8px !important;
  padding-right: 8px !important;
}

.task-table :deep(th.col-date .v-data-table-header__content) {
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 2px;
}

.task-table :deep(th.col-date .v-data-table-header__content span) {
  white-space: nowrap;
}

.cell-chip {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  white-space: nowrap;
}

.chip-fixed {
  flex: 0 1 auto;
  max-width: 100%;
  height: auto !important;
  white-space: nowrap;
}

.chip-fixed :deep(.v-chip__content) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 7.5rem;
}

.cell-wbs {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.title-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}

.title-cell-main {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}

.add-child-btn {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-primary), 0.85);
  cursor: pointer;
  padding: 0;
}

.add-child-btn:hover {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.expand-btn {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  padding: 0;
}

.expand-btn:hover {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}

.expand-spacer {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
}

.title-text {
  min-width: 0;
  white-space: normal;
  word-break: break-word;
  line-height: 1.4;
}

.cell-main {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
  line-height: 1.4;
}

/* 日付列: 折り返さず 2026.07.15 を1行で */
.cell-date {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.text-no-wrap {
  white-space: nowrap;
}
</style>
