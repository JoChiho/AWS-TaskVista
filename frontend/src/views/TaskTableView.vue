<script setup lang="ts">
// テーブルリストビューページ
// Vuetify v-data-table でタスクをソート・フィルター・ページング表示する
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import type { Task } from '@/types/task'
import {
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  normalizeCompletion,
  completionColor,
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

const route = useRoute()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// プロジェクト ID をルートパラメーターから取得する
const projectId = computed(() => route.params.projectId as string)

// タスク詳細ドロワーの表示状態
const showDetail = ref(false)
// タスク作成ダイアログの表示状態
const showCreateForm = ref(false)

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

// 検索入力に 300ms のデバウンスを適用する
watch(searchText, (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedSearch.value = val
  }, 300)
})

// ページネーション設定
const itemsPerPage = ref(20)
const itemsPerPageOptions = [
  { value: 10, title: '10 件' },
  { value: 20, title: '20 件' },
  { value: 50, title: '50 件' },
]

/**
 * テーブルのカラム定義
 * - ステータス（例: レビュー待ち）は chip が収まる幅を確保
 * - 優先度も chip が隣列と重ならないよう余裕を持たせる
 */
const headers = [
  { title: 'タスク名', key: 'title', sortable: true, minWidth: '180px' },
  { title: '要件', key: 'requirement', sortable: false, minWidth: '160px' },
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
    sortable: true,
    minWidth: '100px',
    width: '110px',
  },
  {
    title: '担当者',
    key: 'assigneeName',
    sortable: true,
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
    minWidth: '100px',
    width: '100px',
  },
  {
    title: '予定終了',
    key: 'plannedDueDate',
    sortable: true,
    minWidth: '100px',
    width: '100px',
  },
  {
    title: '実績開始',
    key: 'actualStartDate',
    sortable: true,
    minWidth: '100px',
    width: '100px',
  },
  {
    title: '実績終了',
    key: 'actualDueDate',
    sortable: true,
    minWidth: '100px',
    width: '100px',
  },
  {
    title: '予定工数',
    key: 'estimatedEffortDays',
    sortable: true,
    minWidth: '90px',
    width: '90px',
  },
  {
    title: '実績工数',
    key: 'actualEffortDays',
    sortable: true,
    minWidth: '90px',
    width: '90px',
  },
  {
    title: '作成日',
    key: 'createdAt',
    sortable: true,
    minWidth: '100px',
    width: '100px',
  },
]

/**
 * フィルターと検索を適用したタスク一覧を返す計算プロパティ
 * クライアントサイドで処理する（API への再問い合わせなし）
 */
const filteredTasks = computed<Task[]>(() => {
  return tasksStore.activeTasks.filter((task) => {
    // ステータスフィルター
    if (filterStatus.value && task.status !== filterStatus.value) return false
    // 担当者フィルター（複数担当のいずれかが一致すれば表示）
    if (
      filterAssignee.value &&
      !resolveAssigneeLabels(task).includes(filterAssignee.value)
    ) {
      return false
    }
    // 優先度フィルター
    if (filterPriority.value && task.priority !== filterPriority.value) return false
    // タスク名あいまい検索（大文字小文字を区別しない）
    if (
      debouncedSearch.value &&
      !task.title.toLowerCase().includes(debouncedSearch.value.toLowerCase())
    )
      return false
    return true
  })
})

/** 行クリックでタスク詳細を開く */
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
        @click="showCreateForm = true"
      >
        タスクを追加
      </v-btn>
    </div>

    <!-- 検索とフィルターエリア -->
    <v-row class="mb-4" dense>
      <!-- タスク名検索ボックス -->
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
      <!-- ステータスフィルター -->
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

    <!-- 初回のみスケルトン（再入場時はキャッシュを即表示） -->
    <v-skeleton-loader v-if="showInitialSkeleton" type="table" />

    <!-- タスクテーブル -->
    <v-data-table
      v-else
      :headers="headers"
      :items="filteredTasks"
      :items-per-page="itemsPerPage"
      :items-per-page-options="itemsPerPageOptions"
      hover
      density="comfortable"
      class="elevation-1 rounded-lg task-table"
      no-data-text="タスクが見つかりません"
      @click:row="onRowClick"
    >
      <!-- タスク名（広め・折り返し可） -->
      <template #[`item.title`]="{ item }">
        <span class="text-body-2 font-weight-medium cell-main">
          {{ item.title }}
        </span>
      </template>

      <!-- 要件 -->
      <template #[`item.requirement`]="{ item }">
        <span class="text-body-2 cell-main">
          {{ item.requirement || '—' }}
        </span>
      </template>

      <!-- ステータスカラム（折り返し・隣列との重なり防止） -->
      <template #[`item.status`]="{ item }">
        <div class="cell-chip">
          <v-chip
            :color="STATUS_COLORS[item.status]"
            size="small"
            label
            variant="tonal"
            class="chip-fixed"
          >
            {{ item.status }}
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

      <!-- 予定開始日 -->
      <template #[`item.plannedStartDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(item.plannedStartDate ?? item.startDate) }}
        </span>
      </template>

      <!-- 予定終了日 -->
      <template #[`item.plannedDueDate`]="{ item }">
        <span
          class="text-body-2 cell-date"
          :class="{
            'text-error':
              (item.plannedDueDate || item.dueDate) &&
              new Date(item.plannedDueDate || item.dueDate!) < new Date(),
          }"
        >
          {{ formatTableDate(item.plannedDueDate ?? item.dueDate) }}
        </span>
      </template>

      <!-- 実績開始日 -->
      <template #[`item.actualStartDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(item.actualStartDate) }}
        </span>
      </template>

      <!-- 実績終了日 -->
      <template #[`item.actualDueDate`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(item.actualDueDate) }}
        </span>
      </template>

      <!-- 予定工数 -->
      <template #[`item.estimatedEffortDays`]="{ item }">
        <span class="text-body-2 cell-date">
          {{
            item.estimatedEffortDays != null
              ? `${item.estimatedEffortDays} 人日`
              : '—'
          }}
        </span>
      </template>

      <!-- 実績工数 -->
      <template #[`item.actualEffortDays`]="{ item }">
        <span class="text-body-2 cell-date">
          {{
            item.actualEffortDays != null
              ? `${item.actualEffortDays} 人日`
              : '—'
          }}
        </span>
      </template>

      <!-- 作成日（短い日付・1行固定） -->
      <template #[`item.createdAt`]="{ item }">
        <span class="text-body-2 cell-date">
          {{ formatTableDate(item.createdAt) }}
        </span>
      </template>

      <!-- 進捗 -->
      <template #[`item.completionPercent`]="{ item }">
        <div class="d-flex align-center ga-1" style="min-width: 88px">
          <v-progress-linear
            :model-value="normalizeCompletion(item.completionPercent)"
            :color="completionColor(normalizeCompletion(item.completionPercent))"
            height="6"
            rounded
            style="flex: 1; min-width: 40px"
          />
          <span class="text-caption font-weight-medium" style="width: 32px">
            {{ normalizeCompletion(item.completionPercent) }}%
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

    <!-- タスク詳細サイドドロワー -->
    <TaskDetail
      v-model="showDetail"
      :project-id="projectId"
    />

    <!-- タスク作成ダイアログ -->
    <TaskForm
      v-model="showCreateForm"
      :project-id="projectId"
    />
  </v-container>
</template>

<style scoped>
/* 本文列: タスク名・要件を読みやすく */
.task-table :deep(th),
.task-table :deep(td) {
  vertical-align: middle;
  padding-left: 12px !important;
  padding-right: 12px !important;
}

/* ステータス / 優先度: chip が隣セルに食い込まない */
.task-table :deep(th.col-chip),
.task-table :deep(td.col-chip) {
  white-space: nowrap !important;
  overflow: hidden;
  box-sizing: border-box;
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

.cell-main {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
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
