<script setup lang="ts">
// ダッシュボードページ
// プロジェクト横断の統計と自分の担当タスクを表示する
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ProjectSummary } from '@/types/project'
import type { Task } from '@/types/task'
import { STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/task'
import { fetchDashboardSummary, fetchMyTasks } from '@/api/dashboard'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const uiStore = useUiStore()

// プロジェクト概要データ
const summaries = ref<ProjectSummary[]>([])
// 自分の担当タスク
const myTasks = ref<Task[]>([])
// ローディング状態
const isLoading = ref(false)

/** projectId → プロジェクト名（担当タスク行の右列表示用） */
const projectNameById = computed(() => {
  const map = new Map<string, string>()
  for (const s of summaries.value) {
    map.set(s.projectId, s.name)
  }
  return map
})

/** 期日が近いタスクかどうかを判定する（3 日以内） */
function isDueSoon(dueDate?: string): boolean {
  if (!dueDate) return false
  const due = new Date(dueDate)
  const now = new Date()
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays >= 0 && diffDays <= 3
}

/** 期日が過ぎているかを判定する */
function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

/**
 * ダッシュボード用の短い日付（テーブルと同様 2026.07.15）
 * 長文だと右列が折り返して横スペースを活かせないため
 */
function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '期日なし'
  const d = new Date(dueDate)
  if (Number.isNaN(d.getTime())) return '期日なし'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}.${m}.${day}`
}

function projectLabel(projectId: string): string {
  return projectNameById.value.get(projectId) || 'プロジェクト'
}

/** プロジェクトへ移動する（概要カードなど） */
function goToProject(projectId: string) {
  router.push({ name: 'task-board', params: { projectId } })
}

/**
 * 担当タスク行からかんばんへ遷移し、該当タスクの詳細をすぐ開く
 * query.taskId を TaskBoardView が読み取ってドロワーを開く
 */
function goToMyTask(task: Task) {
  router.push({
    name: 'task-board',
    params: { projectId: task.projectId },
    query: { taskId: task.taskId },
  })
}

/** ダッシュボードデータを読み込む */
async function loadDashboard() {
  isLoading.value = true
  try {
    // 並列でデータを取得する
    const [summaryData, taskData] = await Promise.all([
      fetchDashboardSummary(),
      fetchMyTasks(),
    ])
    summaries.value = summaryData
    myTasks.value = taskData
  } catch {
    uiStore.showError('ダッシュボードの読み込みに失敗しました')
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadDashboard()
})
</script>

<template>
  <v-container class="py-6">
    <!-- ページタイトル -->
    <div class="d-flex align-center mb-6">
      <v-icon size="32" color="primary" class="mr-3">mdi-view-dashboard</v-icon>
      <h1 class="text-h5 font-weight-bold">ダッシュボード</h1>
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="isLoading"
        @click="loadDashboard"
      >
        更新する
      </v-btn>
    </div>

    <!-- ローディング中のスケルトン表示 -->
    <template v-if="isLoading">
      <v-row>
        <v-col v-for="i in 3" :key="i" cols="12" md="4">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
    </template>

    <template v-else>
      <!-- プロジェクト概要セクション -->
      <h2 class="text-h6 font-weight-bold mb-4">
        <v-icon class="mr-2">mdi-folder-multiple</v-icon>
        プロジェクト概要
      </h2>

      <v-row v-if="summaries.length > 0" class="mb-6">
        <v-col
          v-for="summary in summaries"
          :key="summary.projectId"
          cols="12"
          sm="6"
          lg="4"
        >
          <v-card
            hover
            rounded="lg"
            class="cursor-pointer"
            @click="goToProject(summary.projectId)"
          >
            <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
              {{ summary.name }}
            </v-card-title>
            <v-card-text>
              <!-- タスク総数 -->
              <div class="d-flex align-center justify-space-between mb-3">
                <span class="text-body-2 text-medium-emphasis">タスク合計</span>
                <v-chip size="small" color="primary" variant="tonal">
                  {{ summary.totalTasks }} 件
                </v-chip>
              </div>

              <!-- ステータス別の進捗バー -->
              <div v-for="(count, status) in summary.tasksByStatus" :key="status" class="mb-2">
                <div class="d-flex justify-space-between mb-1">
                  <span class="text-caption">{{ status }}</span>
                  <span class="text-caption font-weight-bold">{{ count }}</span>
                </div>
                <v-progress-linear
                  :model-value="summary.totalTasks > 0 ? (count / summary.totalTasks) * 100 : 0"
                  :color="(STATUS_COLORS as Record<string, string>)[status] || 'grey'"
                  height="6"
                  rounded
                />
              </div>
            </v-card-text>
            <v-card-actions>
              <v-btn
                variant="text"
                color="primary"
                size="small"
                append-icon="mdi-arrow-right"
              >
                プロジェクトを開く
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>

      <!-- プロジェクトが存在しない場合の空状態 -->
      <v-card v-else class="mb-6 text-center pa-8" rounded="lg" variant="tonal">
        <v-icon size="48" color="medium-emphasis" class="mb-3">mdi-folder-open-outline</v-icon>
        <p class="text-body-1 text-medium-emphasis">
          プロジェクトがまだありません
        </p>
        <v-btn
          color="primary"
          class="mt-3"
          prepend-icon="mdi-plus"
          :to="{ name: 'projects' }"
        >
          プロジェクトを作成する
        </v-btn>
      </v-card>

      <!-- 自分の担当タスクセクション（横幅を活かした行レイアウト） -->
      <div class="d-flex align-center mb-4">
        <h2 class="text-h6 font-weight-bold mb-0">
          <v-icon class="mr-2">mdi-account-check</v-icon>
          自分の担当タスク
        </h2>
        <v-chip
          v-if="myTasks.length > 0"
          size="small"
          color="primary"
          variant="tonal"
          class="ml-3"
        >
          {{ myTasks.length }} 件
        </v-chip>
      </div>

      <v-card v-if="myTasks.length > 0" rounded="lg" class="my-tasks-panel">
        <!-- ヘッダー行（md 以上で表示・列の意味を明示） -->
        <div class="my-task-header d-none d-md-flex px-4 py-2 text-caption text-medium-emphasis">
          <div class="my-task-col-main">タスク名 / 要望</div>
          <div class="my-task-col-meta">プロジェクト</div>
          <div class="my-task-col-status">ステータス</div>
          <div class="my-task-col-priority">優先度</div>
          <div class="my-task-col-due">期日</div>
          <div class="my-task-col-action" />
        </div>
        <v-divider class="d-none d-md-flex" />

        <div
          v-for="(task, index) in myTasks"
          :key="task.taskId"
        >
          <div
            class="my-task-row px-4 py-3"
            role="button"
            tabindex="0"
            @click="goToMyTask(task)"
            @keydown.enter="goToMyTask(task)"
          >
            <!-- 左: タスク名 + 要望（横幅の大部分） -->
            <div class="my-task-col-main">
              <div class="text-body-1 font-weight-medium my-task-title">
                {{ task.title }}
              </div>
              <div
                v-if="task.requirement"
                class="text-body-2 text-medium-emphasis mt-1 my-task-requirement"
              >
                <span class="text-caption font-weight-medium mr-1">要望</span>
                {{ task.requirement }}
              </div>
            </div>

            <!-- 右メタ情報（横並びでスペース活用） -->
            <div class="my-task-col-meta">
              <v-icon size="14" class="mr-1 text-medium-emphasis">mdi-folder-outline</v-icon>
              <span class="text-body-2 text-medium-emphasis text-truncate">
                {{ projectLabel(task.projectId) }}
              </span>
            </div>

            <div class="my-task-col-status">
              <v-chip
                :color="STATUS_COLORS[task.status]"
                size="small"
                label
                variant="tonal"
              >
                {{ task.status }}
              </v-chip>
            </div>

            <div class="my-task-col-priority">
              <v-chip
                :color="PRIORITY_COLORS[task.priority]"
                size="small"
                label
                variant="tonal"
              >
                {{ PRIORITY_LABELS[task.priority] }}
              </v-chip>
            </div>

            <div class="my-task-col-due">
              <div
                class="d-flex align-center justify-end"
                :class="{
                  'text-error font-weight-bold': isOverdue(task.dueDate),
                  'text-warning font-weight-medium':
                    isDueSoon(task.dueDate) && !isOverdue(task.dueDate),
                }"
              >
                <v-icon
                  v-if="isOverdue(task.dueDate)"
                  size="16"
                  color="error"
                  class="mr-1"
                  title="期日超過"
                >
                  mdi-alert-circle
                </v-icon>
                <v-icon
                  v-else
                  size="14"
                  class="mr-1 text-medium-emphasis"
                >
                  mdi-calendar
                </v-icon>
                <span class="text-body-2 cell-date">{{ formatDueDate(task.dueDate) }}</span>
              </div>
            </div>

            <div class="my-task-col-action">
              <v-icon color="medium-emphasis" size="20">mdi-chevron-right</v-icon>
            </div>
          </div>
          <v-divider v-if="index < myTasks.length - 1" />
        </div>
      </v-card>

      <!-- 担当タスクがない場合の空状態 -->
      <v-card v-else class="text-center pa-6" rounded="lg" variant="tonal">
        <v-icon size="40" color="success" class="mb-2">mdi-check-all</v-icon>
        <p class="text-body-1 text-medium-emphasis">
          担当中のタスクはありません。お疲れさまです！
        </p>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped>
.my-tasks-panel {
  overflow: hidden;
}

/* デスクトップ: 1 行に情報を横展開 */
.my-task-header,
.my-task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.my-task-row {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.my-task-row:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04);
}

.my-task-col-main {
  flex: 1 1 auto;
  min-width: 0;
}

.my-task-col-meta {
  flex: 0 0 140px;
  display: flex;
  align-items: center;
  min-width: 0;
}

.my-task-col-status {
  flex: 0 0 110px;
  display: flex;
  justify-content: flex-start;
}

.my-task-col-priority {
  flex: 0 0 80px;
  display: flex;
  justify-content: flex-start;
}

.my-task-col-due {
  flex: 0 0 120px;
  text-align: right;
}

.my-task-col-action {
  flex: 0 0 28px;
  display: flex;
  justify-content: flex-end;
}

.my-task-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.my-task-requirement {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}

.cell-date {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

/* モバイル: 縦積みにしてメタを折り返し */
@media (max-width: 959px) {
  .my-task-header {
    display: none;
  }

  .my-task-row {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .my-task-col-main {
    flex: 1 1 100%;
    order: 1;
    padding-right: 28px;
  }

  .my-task-col-action {
    position: absolute;
    right: 12px;
    top: 16px;
  }

  .my-task-row {
    position: relative;
  }

  .my-task-col-meta {
    flex: 1 1 40%;
    order: 2;
    margin-top: 8px;
  }

  .my-task-col-status {
    flex: 0 0 auto;
    order: 3;
    margin-top: 8px;
  }

  .my-task-col-priority {
    flex: 0 0 auto;
    order: 4;
    margin-top: 8px;
  }

  .my-task-col-due {
    flex: 1 1 auto;
    order: 5;
    margin-top: 8px;
    text-align: left;
    justify-content: flex-start;
  }

  .my-task-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}
</style>
