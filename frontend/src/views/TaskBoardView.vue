<script setup lang="ts">
// かんばんビュー
// ドラッグは .drag-handle のみ。カード本体クリックで詳細を 1 回で開く。
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import { useDisplayNamesStore } from '@/stores/displayNames'
import type { Task, TaskStatus } from '@/types/task'
import { TASK_STATUSES, STATUS_COLORS } from '@/types/task'
import TaskCard from '@/components/task/TaskCard.vue'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'
import { resolveAssigneeDisplayName, resolveAssigneeLabels } from '@/utils/displayName'
import { prepareTaskForDetail } from '@/utils/kanbanOpen'

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const displayNamesStore = useDisplayNamesStore()

const projectId = computed(() => route.params.projectId as string)

const showDetail = ref(false)
const showCreateForm = ref(false)
const defaultStatus = ref<TaskStatus>('未着手')

const filterAssignee = ref<string | null>(null)
const filterPriority = ref<string | null>(null)

const filteredTasksByStatus = computed(() => {
  const result = {} as Record<TaskStatus, Task[]>
  for (const status of TASK_STATUSES) {
    result[status] = tasksStore.tasks.filter((task) => {
      if (task.isDeleted || task.status !== status) return false
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
})

async function handleDragChange(
  event: { added?: { element: Task } },
  targetStatus: TaskStatus,
) {
  if (!event.added) return
  const task = event.added.element
  if (task.status !== targetStatus) {
    await tasksStore.updateTaskStatus(task.taskId, targetStatus)
  }
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
</script>

<template>
  <v-container fluid class="py-4 px-4">
    <div class="d-flex align-center flex-wrap gap-3 mb-4">
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
      <TaskFilters
        v-model:assignee="filterAssignee"
        v-model:priority="filterPriority"
        :tasks="tasksStore.activeTasks"
        @reset="resetFilters"
      />
    </div>

    <v-row v-if="showInitialSkeleton">
      <v-col v-for="i in 5" :key="i" cols="12" sm="6" md="4" lg="2">
        <v-skeleton-loader type="card, card, card" />
      </v-col>
    </v-row>

    <div
      v-else
      class="d-flex gap-3 overflow-x-auto pb-4"
      style="min-height: calc(100vh - 180px)"
    >
      <div
        v-for="status in TASK_STATUSES"
        :key="status"
        class="flex-shrink-0"
        style="width: 280px; min-width: 280px"
      >
        <div class="d-flex align-center mb-3 px-1">
          <v-chip :color="STATUS_COLORS[status]" size="small" label class="mr-2">
            {{ status }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">
            {{ filteredTasksByStatus[status].length }} 件
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

        <draggable
          :list="filteredTasksByStatus[status]"
          :group="{ name: 'tasks' }"
          item-key="taskId"
          handle=".drag-handle"
          ghost-class="ghost-card"
          chosen-class="chosen-card"
          drag-class="drag-card"
          :animation="200"
          class="task-column"
          style="min-height: 100px"
          @change="handleDragChange($event, status)"
        >
          <template #item="{ element: task }">
            <div class="mb-2" @click="onItemClick(task, $event)">
              <TaskCard :task="task" @open="openTaskDetail" />
            </div>
          </template>
        </draggable>

        <v-btn
          variant="text"
          color="medium-emphasis"
          prepend-icon="mdi-plus"
          size="small"
          block
          class="mt-1"
          @click="openCreateForm(status)"
        >
          タスクを追加する
        </v-btn>
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
}
</style>
