<script setup lang="ts">
// かんばんビューページ
// vuedraggable を使ったドラッグ＆ドロップによるステータス変更を実装する
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import draggable from 'vuedraggable'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import type { Task, TaskStatus } from '@/types/task'
import { TASK_STATUSES, STATUS_COLORS } from '@/types/task'
import TaskCard from '@/components/task/TaskCard.vue'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import TaskFilters from '@/components/task/TaskFilters.vue'

const route = useRoute()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()

// プロジェクト ID をルートパラメーターから取得する
const projectId = computed(() => route.params.projectId as string)

// タスク詳細ドロワーの表示状態
const showDetail = ref(false)
// タスク作成ダイアログの表示状態
const showCreateForm = ref(false)
// 新規タスク作成時のデフォルトステータス
const defaultStatus = ref<TaskStatus>('未着手')

// フィルター条件
const filterAssignee = ref<string | null>(null)
const filterPriority = ref<string | null>(null)

/**
 * フィルター適用後のステータス別タスクグループを返す計算プロパティ
 */
const filteredTasksByStatus = computed(() => {
  const result: Record<TaskStatus, Task[]> = {} as Record<TaskStatus, Task[]>
  for (const status of TASK_STATUSES) {
    result[status] = tasksStore.tasksByStatus[status].filter((task) => {
      if (filterAssignee.value && task.assigneeId !== filterAssignee.value) return false
      if (filterPriority.value && task.priority !== filterPriority.value) return false
      return true
    })
  }
  return result
})

/**
 * ドラッグ＆ドロップでタスクが別のカラムに移動した際の処理
 * 楽観的更新で即座に UI を反映し、API 失敗時はロールバックする
 */
async function handleDragChange(event: any, targetStatus: TaskStatus) {
  // added イベント（別のカラムから追加された）の場合のみ処理する
  if (!event.added) return

  const task: Task = event.added.element
  if (task.status !== targetStatus) {
    await tasksStore.updateTaskStatus(task.taskId, targetStatus)
  }
}

/** 新しいタスクを追加するダイアログを開く */
function openCreateForm(status: TaskStatus) {
  defaultStatus.value = status
  showCreateForm.value = true
}

/** タスクカードをクリックして詳細を開く */
function openTaskDetail(task: Task) {
  tasksStore.currentTask = task
  showDetail.value = true
}

/** フィルターをリセットする */
function resetFilters() {
  filterAssignee.value = null
  filterPriority.value = null
}

onMounted(async () => {
  await Promise.all([
    tasksStore.fetchTasks(projectId.value),
    projectsStore.fetchProject(projectId.value),
  ])
})
</script>

<template>
  <v-container fluid class="py-4 px-4">
    <!-- ページヘッダーとフィルター -->
    <div class="d-flex align-center flex-wrap gap-3 mb-4">
      <h1 class="text-h6 font-weight-bold">
        {{ projectsStore.currentProject?.name ?? 'かんばんビュー' }}
      </h1>
      <v-spacer />
      <!-- フィルターコンポーネント -->
      <TaskFilters
        v-model:assignee="filterAssignee"
        v-model:priority="filterPriority"
        :tasks="tasksStore.activeTasks"
        @reset="resetFilters"
      />
    </div>

    <!-- ローディング中のスケルトン表示 -->
    <v-row v-if="tasksStore.isLoading">
      <v-col v-for="i in 5" :key="i" cols="12" sm="6" md="4" lg="2">
        <v-skeleton-loader type="card, card, card" />
      </v-col>
    </v-row>

    <!-- かんばんボード本体 -->
    <div
      v-else
      class="d-flex gap-3 overflow-x-auto pb-4"
      style="min-height: calc(100vh - 180px)"
    >
      <!-- ステータスカラム -->
      <div
        v-for="status in TASK_STATUSES"
        :key="status"
        class="flex-shrink-0"
        style="width: 280px; min-width: 280px"
      >
        <!-- カラムヘッダー -->
        <div class="d-flex align-center mb-3 px-1">
          <v-chip
            :color="STATUS_COLORS[status]"
            size="small"
            label
            class="mr-2"
          >
            {{ status }}
          </v-chip>
          <span class="text-caption text-medium-emphasis">
            {{ filteredTasksByStatus[status].length }} 件
          </span>
          <v-spacer />
          <!-- カラムへのタスク追加ボタン -->
          <v-btn
            icon="mdi-plus"
            variant="text"
            size="x-small"
            density="compact"
            @click="openCreateForm(status)"
          />
        </div>

        <!-- タスクカードのドラッグ可能なリスト -->
        <draggable
          :list="filteredTasksByStatus[status]"
          :group="{ name: 'tasks' }"
          item-key="taskId"
          ghost-class="ghost-card"
          chosen-class="chosen-card"
          drag-class="drag-card"
          animation="200"
          class="task-column"
          style="min-height: 100px"
          @change="handleDragChange($event, status)"
        >
          <template #item="{ element: task }">
            <div class="mb-2">
              <TaskCard
                :task="task"
                @click="openTaskDetail(task)"
              />
            </div>
          </template>
        </draggable>

        <!-- カラムへのタスク追加ボタン（下部） -->
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

    <!-- タスク詳細サイドドロワー -->
    <TaskDetail
      v-model="showDetail"
      :project-id="projectId"
    />

    <!-- タスク作成ダイアログ -->
    <TaskForm
      v-model="showCreateForm"
      :project-id="projectId"
      :default-status="defaultStatus"
    />
  </v-container>
</template>

<style scoped>
/* ドラッグ中のゴーストカードのスタイル */
.ghost-card {
  opacity: 0.4;
  background: rgb(var(--v-theme-primary), 0.1);
  border: 2px dashed rgb(var(--v-theme-primary));
  border-radius: 8px;
}

/* ドラッグ中の本体カードのスタイル */
.drag-card {
  transform: rotate(2deg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15) !important;
}

/* タスクカラムのスクロール設定 */
.task-column {
  padding: 4px;
}
</style>
