<script setup lang="ts">
// テーブルリストビューページ
// Vuetify v-data-table でタスクをソート・フィルター・ページング表示する
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import type { Task } from '@/types/task'
import { STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/task'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import { resolveAssigneeDisplayName } from '@/utils/displayName'

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

// タイトル検索文字列
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

/** テーブルのカラム定義 */
const headers = [
  { title: '要望', key: 'requirement', sortable: false },
  { title: 'タイトル', key: 'title', sortable: true },
  { title: 'ステータス', key: 'status', sortable: true, width: '130px' },
  { title: '担当者', key: 'assigneeName', sortable: true, width: '120px' },
  { title: '優先度', key: 'priority', sortable: true, width: '100px' },
  { title: '期日', key: 'dueDate', sortable: true, width: '120px' },
  { title: '作成日', key: 'createdAt', sortable: true, width: '120px' },
]

/**
 * フィルターと検索を適用したタスク一覧を返す計算プロパティ
 * クライアントサイドで処理する（API への再問い合わせなし）
 */
const filteredTasks = computed<Task[]>(() => {
  return tasksStore.activeTasks.filter((task) => {
    // ステータスフィルター
    if (filterStatus.value && task.status !== filterStatus.value) return false
    // 担当者フィルター（表示名解決後のラベルで照合）
    if (
      filterAssignee.value &&
      resolveAssigneeDisplayName(task) !== filterAssignee.value
    ) {
      return false
    }
    // 優先度フィルター
    if (filterPriority.value && task.priority !== filterPriority.value) return false
    // タイトルあいまい検索（大文字小文字を区別しない）
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

/** 日付をフォーマットする */
function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** フィルターをリセットする */
function resetFilters() {
  filterAssignee.value = null
  filterPriority.value = null
  filterStatus.value = null
  searchText.value = ''
}

onMounted(async () => {
  // 先に members 表示名を入れてからタスクを読む（メール担当 → 人名）
  await projectsStore.fetchProject(projectId.value)
  await tasksStore.fetchTasks(projectId.value)
  const { useDisplayNamesStore } = await import('@/stores/displayNames')
  await useDisplayNamesStore().applyToEntityStores()
})
</script>

<template>
  <v-container fluid class="py-4">
    <!-- ページヘッダー -->
    <div class="d-flex align-center flex-wrap gap-3 mb-4">
      <h1 class="text-h6 font-weight-bold">
        {{ projectsStore.currentProject?.name ?? 'テーブルビュー' }}
      </h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        size="small"
        @click="showCreateForm = true"
      >
        タスクを追加する
      </v-btn>
    </div>

    <!-- 検索とフィルターエリア -->
    <v-row class="mb-4" dense>
      <!-- タイトル検索ボックス -->
      <v-col cols="12" md="4">
        <v-text-field
          v-model="searchText"
          prepend-inner-icon="mdi-magnify"
          placeholder="タスクを検索する"
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

    <!-- ローディング中のスケルトン表示 -->
    <v-skeleton-loader v-if="tasksStore.isLoading" type="table" />

    <!-- タスクテーブル -->
    <v-data-table
      v-else
      :headers="headers"
      :items="filteredTasks"
      :items-per-page="itemsPerPage"
      :items-per-page-options="itemsPerPageOptions"
      hover
      density="comfortable"
      class="elevation-1 rounded-lg"
      no-data-text="タスクが見つかりません"
      @click:row="onRowClick"
    >
      <!-- ステータスカラム -->
      <template #[`item.status`]="{ item }">
        <v-chip
          :color="STATUS_COLORS[item.status]"
          size="small"
          label
          variant="tonal"
        >
          {{ item.status }}
        </v-chip>
      </template>

      <!-- 優先度カラム -->
      <template #[`item.priority`]="{ item }">
        <v-chip
          :color="PRIORITY_COLORS[item.priority]"
          size="small"
          label
          variant="tonal"
        >
          {{ PRIORITY_LABELS[item.priority] }}
        </v-chip>
      </template>

      <!-- 期日カラム -->
      <template #[`item.dueDate`]="{ item }">
        <span
          :class="{
            'text-error': item.dueDate && new Date(item.dueDate) < new Date(),
          }"
        >
          {{ formatDate(item.dueDate) }}
        </span>
      </template>

      <!-- 作成日カラム -->
      <template #[`item.createdAt`]="{ item }">
        {{ formatDate(item.createdAt) }}
      </template>

      <!-- 担当者カラム（クラウド表示名と連動） -->
      <template #[`item.assigneeName`]="{ item }">
        <span class="text-body-2">
          {{ resolveAssigneeDisplayName(item) || '—' }}
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
