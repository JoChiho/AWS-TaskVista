<script setup lang="ts">
// ダッシュボードページ
// プロジェクト横断の統計と自分の担当タスクを表示する
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ProjectSummary } from '@/types/project'
import type { Task } from '@/types/task'
import { STATUS_COLORS } from '@/types/task'
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

/** 期日をフォーマットする */
function formatDueDate(dueDate?: string): string {
  if (!dueDate) return '期日なし'
  return new Date(dueDate).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** プロジェクトへ移動する */
function goToProject(projectId: string) {
  router.push({ name: 'task-board', params: { projectId } })
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

      <!-- 自分の担当タスクセクション -->
      <h2 class="text-h6 font-weight-bold mb-4">
        <v-icon class="mr-2">mdi-account-check</v-icon>
        自分の担当タスク
      </h2>

      <v-card v-if="myTasks.length > 0" rounded="lg">
        <v-list lines="two">
          <template v-for="(task, index) in myTasks" :key="task.taskId">
            <v-list-item
              :to="{ name: 'task-board', params: { projectId: task.projectId } }"
            >
              <template #prepend>
                <v-chip
                  :color="STATUS_COLORS[task.status]"
                  size="x-small"
                  class="mr-3"
                  label
                >
                  {{ task.status }}
                </v-chip>
              </template>
              <v-list-item-title class="font-weight-medium">
                {{ task.title }}
              </v-list-item-title>
              <v-list-item-subtitle>
                <v-icon size="12" class="mr-1">mdi-calendar</v-icon>
                <span
                  :class="{
                    'text-error': isOverdue(task.dueDate),
                    'text-warning': isDueSoon(task.dueDate) && !isOverdue(task.dueDate),
                  }"
                >
                  {{ formatDueDate(task.dueDate) }}
                </span>
              </v-list-item-subtitle>
              <template #append>
                <v-icon
                  v-if="isOverdue(task.dueDate)"
                  color="error"
                  size="16"
                  title="期日超過"
                >
                  mdi-alert-circle
                </v-icon>
              </template>
            </v-list-item>
            <v-divider v-if="index < myTasks.length - 1" />
          </template>
        </v-list>
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
