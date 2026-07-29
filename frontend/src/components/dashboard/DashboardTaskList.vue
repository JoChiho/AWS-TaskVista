<script setup lang="ts">
import { computed } from 'vue'
import type { DashboardTask } from '@/types/task'
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
} from '@/types/task'
import { formatReviewerList } from '@/utils/displayName'

const props = withDefaults(
  defineProps<{
    tasks: DashboardTask[]
    reviewMode?: boolean
  }>(),
  {
    reviewMode: false,
  },
)

const emit = defineEmits<{
  open: [task: DashboardTask]
}>()

const groups = computed(() => {
  const byProject = new Map<string, DashboardTask[]>()
  for (const task of props.tasks) {
    const list = byProject.get(task.projectId) ?? []
    list.push(task)
    byProject.set(task.projectId, list)
  }
  return Array.from(byProject.entries()).map(([projectId, tasks]) => ({
    projectId,
    projectName: tasks[0]?.projectName || 'プロジェクト',
    tasks,
  }))
})

function dueDate(task: DashboardTask): string | undefined {
  return task.plannedDueDate || task.dueDate || undefined
}

function dateOnly(value?: string): string {
  if (!value) return '未設定'
  const date = value.slice(0, 10)
  return date.length === 10 ? date.replaceAll('-', '.') : value
}

function today(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function urgency(task: DashboardTask): 'overdue' | 'soon' | 'normal' | 'none' {
  const due = dueDate(task)?.slice(0, 10)
  if (!due) return 'none'
  if (['完了', 'レビュー待ち', '保留'].includes(task.status)) return 'normal'
  const current = today()
  if (due < current) return 'overdue'
  if (due <= addDays(current, 7)) return 'soon'
  return 'normal'
}

function pathLabel(task: DashboardTask): string {
  return (task.wbsPath ?? [])
    .map((item) => `${item.wbsCode ? `${item.wbsCode} ` : ''}${item.title}`)
    .join(' / ')
}

function completion(task: DashboardTask): number {
  const value = Number(task.completionPercent ?? 0)
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}
</script>

<template>
  <div class="dashboard-task-groups">
    <v-card
      v-for="group in groups"
      :key="group.projectId"
      rounded="lg"
      variant="outlined"
      class="mb-4 overflow-hidden"
    >
      <div class="project-group-header d-flex align-center px-4 py-3">
        <v-icon size="18" color="primary" class="mr-2">mdi-folder-outline</v-icon>
        <span class="font-weight-bold text-body-1 text-truncate">
          {{ group.projectName }}
        </span>
        <v-chip size="x-small" variant="tonal" color="primary" class="ml-3">
          {{ group.tasks.length }} 件
        </v-chip>
        <v-spacer />
        <v-btn
          size="x-small"
          variant="text"
          prepend-icon="mdi-file-tree"
          :to="{ name: 'task-wbs', params: { projectId: group.projectId } }"
        >
          構成
        </v-btn>
        <v-btn
          size="x-small"
          variant="text"
          prepend-icon="mdi-chart-gantt"
          :to="{ name: 'task-timeline', params: { projectId: group.projectId } }"
        >
          ガント
        </v-btn>
      </div>

      <v-divider />

      <div
        v-for="(task, index) in group.tasks"
        :key="task.taskId"
      >
        <div
          class="dashboard-task-row px-4 py-3"
          role="button"
          tabindex="0"
          @click="emit('open', task)"
          @keydown.enter="emit('open', task)"
        >
          <div class="task-identity">
            <div class="d-flex align-center ga-2">
              <v-chip
                v-if="task.wbsCode"
                size="x-small"
                color="primary"
                variant="tonal"
                label
              >
                {{ task.wbsCode }}
              </v-chip>
              <span class="font-weight-medium text-body-1 task-title">
                {{ task.title }}
              </span>
            </div>
            <div
              v-if="pathLabel(task)"
              class="text-caption text-medium-emphasis mt-1 task-path"
              :title="pathLabel(task)"
            >
              <v-icon size="12" class="mr-1">mdi-file-tree-outline</v-icon>
              {{ pathLabel(task) }}
            </div>
            <div
              v-if="reviewMode && formatReviewerList(task)"
              class="text-caption text-medium-emphasis mt-1"
            >
              <v-icon size="12" class="mr-1">mdi-account-check-outline</v-icon>
              レビュアー: {{ formatReviewerList(task) }}
            </div>
          </div>

          <div class="task-progress">
            <div class="d-flex align-center justify-space-between text-caption mb-1">
              <span>進捗</span>
              <strong>{{ completion(task) }}%</strong>
            </div>
            <v-progress-linear
              :model-value="completion(task)"
              color="primary"
              height="6"
              rounded
            />
          </div>

          <div class="task-chips d-flex align-center ga-2">
            <v-chip
              :color="reviewMode ? 'warning' : STATUS_COLORS[task.status]"
              size="small"
              label
              variant="tonal"
            >
              {{ task.status }}
            </v-chip>
            <v-chip
              :color="PRIORITY_COLORS[task.priority]"
              size="small"
              label
              variant="tonal"
            >
              {{ PRIORITY_LABELS[task.priority] }}
            </v-chip>
          </div>

          <div
            class="task-schedule text-body-2"
            :class="{
              'text-error font-weight-bold': urgency(task) === 'overdue',
              'text-warning font-weight-medium': urgency(task) === 'soon',
            }"
          >
            <div class="text-caption text-medium-emphasis">予定</div>
            <div class="d-flex align-center justify-end">
              <v-icon
                size="15"
                class="mr-1"
                :color="urgency(task) === 'overdue' ? 'error' : undefined"
              >
                {{ urgency(task) === 'overdue' ? 'mdi-alert-circle' : 'mdi-calendar-range' }}
              </v-icon>
              {{ dateOnly(task.plannedStartDate || task.startDate) }}
              <span class="mx-1">→</span>
              {{ dateOnly(dueDate(task)) }}
            </div>
          </div>

          <v-icon color="medium-emphasis" size="20">mdi-chevron-right</v-icon>
        </div>
        <v-divider v-if="index < group.tasks.length - 1" />
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.project-group-header {
  min-height: 52px;
  background: rgba(var(--v-theme-primary), 0.035);
}

.dashboard-task-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 130px auto 210px 24px;
  align-items: center;
  gap: 18px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.dashboard-task-row:hover {
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.task-identity,
.task-title,
.task-path {
  min-width: 0;
}

.task-title,
.task-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-schedule {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 1100px) {
  .dashboard-task-row {
    grid-template-columns: minmax(240px, 1fr) 110px auto 24px;
  }

  .task-schedule {
    grid-column: 1 / 4;
    text-align: left;
  }

  .task-schedule > div {
    justify-content: flex-start !important;
  }
}

@media (max-width: 700px) {
  .project-group-header {
    flex-wrap: wrap;
  }

  .project-group-header .v-spacer {
    flex-basis: 100%;
  }

  .dashboard-task-row {
    grid-template-columns: 1fr 24px;
    gap: 12px;
  }

  .task-progress,
  .task-chips,
  .task-schedule {
    grid-column: 1 / 2;
  }

  .dashboard-task-row > .v-icon {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
