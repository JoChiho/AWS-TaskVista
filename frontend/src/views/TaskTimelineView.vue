<script setup lang="ts">
// タスク時間線（ガント / カレンダー）ビュー
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import { useDisplayNamesStore } from '@/stores/displayNames'
import { useAuthStore } from '@/stores/auth'
import type { Task } from '@/types/task'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import TaskTimeline from '@/components/task/TaskTimeline.vue'
import {
  resolveAssigneeLabels,
  resolveAssigneeDisplayName,
} from '@/utils/displayName'
import { prepareTaskForDetail } from '@/utils/kanbanOpen'

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const displayNamesStore = useDisplayNamesStore()
const authStore = useAuthStore()

const projectId = computed(() => route.params.projectId as string)

const showDetail = ref(false)
const showCreateForm = ref(false)
const filterAssignee = ref<string | null>(null)
const filterPriority = ref<string | null>(null)
const filterStatus = ref<string | null>(null)
const savingStartDate = ref(false)

/** 全体 / 自分のタスク */
const scope = ref<'all' | 'mine'>('all')

function isAssignedToMe(task: Task): boolean {
  const sub = authStore.currentUser?.sub
  if (!sub) return false
  if (task.assigneeId === sub) return true
  if (task.assignees?.some((a) => a.userId === sub)) return true
  return false
}

const scopedTasks = computed(() => {
  const base = tasksStore.activeTasks
  if (scope.value === 'mine') {
    return base.filter(isAssignedToMe)
  }
  return base
})

const filteredTasks = computed(() => {
  return scopedTasks.value.filter((task) => {
    if (filterStatus.value && task.status !== filterStatus.value) return false
    if (
      filterAssignee.value &&
      !resolveAssigneeLabels(task).includes(filterAssignee.value)
    ) {
      return false
    }
    if (filterPriority.value && task.priority !== filterPriority.value) return false
    return true
  })
})

const myTaskCount = computed(
  () => tasksStore.activeTasks.filter(isAssignedToMe).length,
)

function openTaskDetail(task: Task) {
  const prepared = prepareTaskForDetail(task, resolveAssigneeDisplayName)
  if (!prepared) return
  tasksStore.currentTask = prepared
  showDetail.value = true
  if (route.query.taskId !== prepared.taskId) {
    void router
      .replace({
        name: 'task-timeline',
        params: { projectId: projectId.value },
        query: { ...route.query, taskId: prepared.taskId },
      })
      .catch(() => {})
  }
}

/** カレンダーへドロップ → 開始日を API 保存 */
async function onSetStartDate(payload: {
  taskId: string
  startDate: string
  task: Task
}): Promise<void> {
  if (savingStartDate.value) return
  savingStartDate.value = true
  try {
    await tasksStore.updateTask(payload.taskId, {
      startDate: payload.startDate,
    })
  } finally {
    savingStartDate.value = false
  }
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
  filterStatus.value = null
}

watch(showDetail, (open) => {
  if (open) return
  if (!route.query.taskId) return
  const nextQuery = { ...route.query }
  delete nextQuery.taskId
  void router
    .replace({
      name: 'task-timeline',
      params: { projectId: projectId.value },
      query: nextQuery,
    })
    .catch(() => {})
})

const showInitialSkeleton = computed(
  () =>
    tasksStore.isLoading &&
    !tasksStore.hasDataForCurrentProject &&
    tasksStore.currentProjectId === projectId.value,
)

async function loadTimeline(): Promise<void> {
  const id = projectId.value
  if (!id) return
  await Promise.all([
    projectsStore.ensureProject(id),
    tasksStore.ensureTasks(id),
  ])
  if (projectsStore.currentProject) {
    displayNamesStore.ingestProject(projectsStore.currentProject)
  }
  displayNamesStore.ingestTasks(tasksStore.tasks)
  await openTaskFromQuery()
}

onMounted(() => {
  void loadTimeline()
})

watch(projectId, () => {
  void loadTimeline()
})
</script>

<template>
  <v-container fluid class="py-4 px-4 timeline-page">
    <div class="page-header d-flex align-center flex-wrap ga-3 mb-3">
      <div class="min-w-0">
        <h1 class="text-h6 font-weight-bold mb-0 text-truncate">
          {{ projectsStore.currentProject?.name ?? '時間線' }}
        </h1>
        <p class="text-caption text-medium-emphasis mb-0 mt-1">
          開始日を基準に予定工数分の期間を表示（締切からの逆算なし）
        </p>
      </div>
      <v-progress-circular
        v-if="tasksStore.isRefreshing || projectsStore.isRefreshing"
        indeterminate
        size="18"
        width="2"
        color="primary"
        title="最新データを確認中"
      />
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

    <!-- 表示対象: 全体 / 自分 -->
    <div class="scope-bar d-flex align-center flex-wrap ga-3 mb-3">
      <v-btn-toggle
        v-model="scope"
        mandatory
        density="comfortable"
        color="primary"
        rounded="lg"
        divided
        class="scope-toggle"
      >
        <v-btn value="all" size="small" prepend-icon="mdi-account-group-outline">
          全体
          <v-chip
            class="ml-2"
            size="x-small"
            label
            :variant="scope === 'all' ? 'flat' : 'tonal'"
          >
            {{ tasksStore.activeTasks.length }}
          </v-chip>
        </v-btn>
        <v-btn value="mine" size="small" prepend-icon="mdi-account-outline">
          自分のタスク
          <v-chip
            class="ml-2"
            size="x-small"
            label
            :variant="scope === 'mine' ? 'flat' : 'tonal'"
          >
            {{ myTaskCount }}
          </v-chip>
        </v-btn>
      </v-btn-toggle>

      <TaskFilters
        v-model:assignee="filterAssignee"
        v-model:priority="filterPriority"
        v-model:status="filterStatus"
        :tasks="scopedTasks"
        show-status-filter
        @reset="resetFilters"
      />
    </div>

    <v-alert
      v-if="scope === 'mine' && myTaskCount === 0 && !showInitialSkeleton"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      icon="mdi-information-outline"
    >
      あなたが担当に設定されているタスクがありません。担当者を設定するか「全体」に切り替えてください。
    </v-alert>

    <v-skeleton-loader v-if="showInitialSkeleton" type="image, list-item@6" />

    <TaskTimeline
      v-else
      :tasks="filteredTasks"
      :saving-start-date="savingStartDate"
      @open="openTaskDetail"
      @set-start-date="onSetStartDate"
    />

    <TaskDetail v-model="showDetail" :project-id="projectId" />
    <TaskForm v-model="showCreateForm" :project-id="projectId" />
  </v-container>
</template>

<style scoped>
.timeline-page {
  max-width: 100%;
}
.scope-bar {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.scope-toggle {
  flex-shrink: 0;
}
.min-w-0 {
  min-width: 0;
}
</style>
