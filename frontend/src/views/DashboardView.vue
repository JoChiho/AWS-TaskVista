<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import DashboardTaskList from '@/components/dashboard/DashboardTaskList.vue'
import {
  fetchDashboardSummary,
  fetchMyReviewTasks,
  fetchMyTasks,
} from '@/api/dashboard'
import { useUiStore } from '@/stores/ui'
import type { ProjectSummary } from '@/types/project'
import {
  projectStatusColor,
  projectStatusLabel,
} from '@/types/project'
import type { DashboardTask } from '@/types/task'

const router = useRouter()
const uiStore = useUiStore()

const summaries = ref<ProjectSummary[]>([])
const myTasks = ref<DashboardTask[]>([])
const reviewTasks = ref<DashboardTask[]>([])
const isLoading = ref(false)

function formatUpdatedAt(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatProjectDate(value?: string): string {
  if (!value) return '未設定'
  const date = value.slice(0, 10)
  return date.length === 10 ? date.slice(5).replace('-', '/') : value
}

function formatEffort(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function goToProject(projectId: string) {
  router.push({ name: 'task-board', params: { projectId } })
}

function goToMyTask(task: DashboardTask) {
  router.push({
    name: 'task-board',
    params: { projectId: task.projectId },
    query: { taskId: task.taskId },
  })
}

function goToReviewTask(task: DashboardTask) {
  router.push({
    name: 'task-board',
    params: { projectId: task.projectId },
    query: { taskId: task.taskId, myReview: '1' },
  })
}

async function loadDashboard() {
  isLoading.value = true
  try {
    const [summaryData, taskData, reviewData] = await Promise.all([
      fetchDashboardSummary(),
      fetchMyTasks(),
      fetchMyReviewTasks(),
    ])
    summaries.value = summaryData
    myTasks.value = taskData
    reviewTasks.value = reviewData
  } catch {
    uiStore.showError('ダッシュボードの読み込みに失敗しました')
  } finally {
    isLoading.value = false
  }
}

onMounted(loadDashboard)
</script>

<template>
  <v-container class="py-6 dashboard-container">
    <div class="d-flex align-center mb-6">
      <v-icon size="32" color="primary" class="mr-3">mdi-view-dashboard</v-icon>
      <div>
        <h1 class="text-h5 font-weight-bold">ダッシュボード</h1>
        <p class="text-caption text-medium-emphasis mb-0">
          プロジェクト横断の WBS 進捗と、自分が対応する実行タスク
        </p>
      </div>
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-refresh"
        :loading="isLoading"
        @click="loadDashboard"
      >
        更新
      </v-btn>
    </div>

    <template v-if="isLoading">
      <v-row>
        <v-col v-for="index in 3" :key="index" cols="12" md="4">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
    </template>

    <template v-else>
      <div class="d-flex align-center mb-4">
        <h2 class="text-h6 font-weight-bold mb-0">
          <v-icon class="mr-2">mdi-folder-multiple</v-icon>
          プロジェクト概要
        </h2>
        <v-chip
          v-if="summaries.length > 0"
          size="small"
          color="primary"
          variant="tonal"
          class="ml-3"
        >
          {{ summaries.length }} 件
        </v-chip>
      </div>

      <v-row v-if="summaries.length > 0" class="mb-6">
        <v-col
          v-for="summary in summaries"
          :key="summary.projectId"
          cols="12"
          md="6"
          xl="4"
        >
          <v-card
            hover
            rounded="lg"
            class="cursor-pointer dashboard-project-card"
            height="100%"
            @click="goToProject(summary.projectId)"
          >
            <v-card-title class="d-flex align-center pt-4">
              <span class="text-subtitle-1 font-weight-bold flex-grow-1 text-truncate">
                {{ summary.name }}
              </span>
              <v-chip
                :color="projectStatusColor(summary.status)"
                size="x-small"
                variant="tonal"
                class="ml-2 flex-shrink-0"
              >
                {{ projectStatusLabel(summary.status) }}
              </v-chip>
            </v-card-title>

            <v-card-text>
              <div class="d-flex align-center text-caption text-medium-emphasis mb-4">
                <v-icon size="14" class="mr-1">mdi-account-group</v-icon>
                {{ summary.memberCount ?? '—' }} 人
                <v-spacer />
                <v-icon size="14" class="mr-1">mdi-update</v-icon>
                {{ formatUpdatedAt(summary.lastUpdatedAt) }}
              </div>

              <div class="d-flex align-end justify-space-between mb-2">
                <div>
                  <div class="text-caption text-medium-emphasis">全体進捗</div>
                  <div class="text-h5 font-weight-bold text-primary">
                    {{ summary.completionPercent ?? 0 }}%
                  </div>
                </div>
                <div class="text-right text-caption text-medium-emphasis">
                  <div>予定期間</div>
                  <strong class="text-body-2 text-high-emphasis">
                    {{ formatProjectDate(summary.plannedStartDate) }}
                    →
                    {{ formatProjectDate(summary.plannedDueDate) }}
                  </strong>
                </div>
              </div>

              <v-progress-linear
                :model-value="summary.completionPercent ?? 0"
                color="primary"
                height="9"
                rounded
                class="mb-4"
              />

              <div class="project-metrics mb-4">
                <div class="project-metric">
                  <span>実行</span>
                  <strong>{{ summary.leafTaskCount ?? summary.totalTasks }}</strong>
                </div>
                <div class="project-metric">
                  <span>完了</span>
                  <strong class="text-success">
                    {{ summary.leafTasksByStatus?.['完了'] ?? summary.tasksByStatus['完了'] ?? 0 }}
                  </strong>
                </div>
                <div class="project-metric">
                  <span>期限超過</span>
                  <strong :class="{ 'text-error': (summary.overdueTaskCount ?? 0) > 0 }">
                    {{ summary.overdueTaskCount ?? 0 }}
                  </strong>
                </div>
                <div class="project-metric">
                  <span>レビュー</span>
                  <strong :class="{ 'text-warning': (summary.reviewTaskCount ?? 0) > 0 }">
                    {{ summary.reviewTaskCount ?? 0 }}
                  </strong>
                </div>
              </div>

              <div class="d-flex flex-wrap ga-2">
                <v-chip size="x-small" variant="tonal">
                  WBS {{ summary.totalNodeCount ?? summary.totalTasks }} ノード
                </v-chip>
                <v-chip size="x-small" variant="tonal">
                  親 {{ summary.summaryTaskCount ?? 0 }}
                </v-chip>
                <v-chip
                  v-if="(summary.dueSoonTaskCount ?? 0) > 0"
                  size="x-small"
                  color="warning"
                  variant="tonal"
                >
                  7日以内 {{ summary.dueSoonTaskCount ?? 0 }}
                </v-chip>
              </div>

              <div class="d-flex justify-space-between mt-3 text-caption">
                <span class="text-medium-emphasis">予定工数</span>
                <strong>{{ formatEffort(summary.estimatedEffortDays) }} 人日</strong>
              </div>
              <div class="d-flex justify-space-between mt-1 text-caption">
                <span class="text-medium-emphasis">実績工数</span>
                <strong>{{ formatEffort(summary.actualEffortDays) }} 人日</strong>
              </div>
            </v-card-text>

            <v-card-actions class="px-4 pb-4 ga-1">
              <v-btn
                variant="tonal"
                color="primary"
                size="small"
                prepend-icon="mdi-view-kanban"
                :to="{ name: 'task-board', params: { projectId: summary.projectId } }"
                @click.stop
              >
                かんばん
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                prepend-icon="mdi-chart-gantt"
                :to="{ name: 'task-timeline', params: { projectId: summary.projectId } }"
                @click.stop
              >
                ガント
              </v-btn>
              <v-btn
                variant="text"
                size="small"
                prepend-icon="mdi-file-tree"
                :to="{ name: 'task-wbs', params: { projectId: summary.projectId } }"
                @click.stop
              >
                構成
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>

      <v-card v-else class="mb-8 text-center pa-8" rounded="lg" variant="tonal">
        <v-icon size="48" color="medium-emphasis" class="mb-3">
          mdi-folder-open-outline
        </v-icon>
        <p class="text-body-1 text-medium-emphasis">プロジェクトがまだありません</p>
        <v-btn
          color="primary"
          class="mt-3"
          prepend-icon="mdi-plus"
          :to="{ name: 'projects' }"
        >
          プロジェクトを作成
        </v-btn>
      </v-card>

      <div class="d-flex align-center mb-1">
        <h2 class="text-h6 font-weight-bold mb-0">
          <v-icon class="mr-2">mdi-account-check</v-icon>
          担当タスク
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
      <p class="text-caption text-medium-emphasis mb-4">
        自分が担当する、子を持たない実行タスクのみ表示します
      </p>

      <DashboardTaskList
        v-if="myTasks.length > 0"
        :tasks="myTasks"
        class="mb-8"
        @open="goToMyTask"
      />
      <v-card
        v-else
        class="text-center pa-6 mb-8"
        rounded="lg"
        variant="tonal"
      >
        <v-icon size="40" color="success" class="mb-2">mdi-check-all</v-icon>
        <p class="text-body-1 text-medium-emphasis mb-0">
          担当中の実行タスクはありません
        </p>
      </v-card>

      <div class="d-flex align-center mb-1">
        <h2 class="text-h6 font-weight-bold mb-0">
          <v-icon class="mr-2" color="warning">mdi-clipboard-check-outline</v-icon>
          レビュー待ちのタスク
        </h2>
        <v-chip
          v-if="reviewTasks.length > 0"
          size="small"
          color="warning"
          variant="tonal"
          class="ml-3"
        >
          {{ reviewTasks.length }} 件
        </v-chip>
      </div>
      <p class="text-caption text-medium-emphasis mb-4">
        自分がレビュアーに指定された、子を持たない実行タスク
      </p>

      <DashboardTaskList
        v-if="reviewTasks.length > 0"
        :tasks="reviewTasks"
        review-mode
        @open="goToReviewTask"
      />
      <v-card v-else class="text-center pa-6" rounded="lg" variant="tonal">
        <v-icon size="40" color="success" class="mb-2">mdi-clipboard-check</v-icon>
        <p class="text-body-1 text-medium-emphasis mb-0">
          レビュー待ちの実行タスクはありません
        </p>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped>
.dashboard-container {
  max-width: 1500px;
}

.dashboard-project-card {
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
}

.project-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.project-metric {
  padding: 8px 4px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  text-align: center;
}

.project-metric span,
.project-metric strong {
  display: block;
}

.project-metric span {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
}

@media (max-width: 600px) {
  .project-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
