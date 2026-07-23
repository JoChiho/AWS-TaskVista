<script setup lang="ts">
/**
 * WBS 構成ビュー
 * - 詳細マップ: 情報リッチな mind-map（DnD なし）
 * - 構成マップ: 緊凑 mind-map + 階層ガイド + DnD で構造編集
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTasksStore } from '@/stores/tasks'
import { useProjectsStore } from '@/stores/projects'
import { useDisplayNamesStore } from '@/stores/displayNames'
import type { Task } from '@/types/task'
import TaskDetail from '@/components/task/TaskDetail.vue'
import TaskForm from '@/components/task/TaskForm.vue'
import WbsMindMapNode from '@/components/task/WbsMindMapNode.vue'
import WbsCompactMap from '@/components/task/WbsCompactMap.vue'
import {
  childrenOf,
  collectParentIds,
  displaySchedule,
  hasChildren,
} from '@/utils/wbs'
import {
  resolveAssigneeDisplayName,
} from '@/utils/displayName'
import { prepareTaskForDetail } from '@/utils/kanbanOpen'
import {
  PROJECT_STATUS_COLORS,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from '@/types/project'
import {
  STATUS_COLORS,
  TASK_STATUSES,
  normalizeCompletion,
  type TaskStatus,
} from '@/types/task'

const route = useRoute()
const router = useRouter()
const tasksStore = useTasksStore()
const projectsStore = useProjectsStore()
const displayNamesStore = useDisplayNamesStore()

const projectId = computed(() => route.params.projectId as string)

const showDetail = ref(false)
const showCreateForm = ref(false)
/** 新規作成時の既定親（子追加用） */
const createParentId = ref<string | null>(null)
const renumbering = ref(false)
const structureBusy = ref(false)

/** 詳細マップ | 構成マップ（緊凑 + DnD） */
const viewMode = ref<'map' | 'outline'>('map')

const expandedIds = ref<Set<string>>(new Set())
const expandedInited = ref(false)

/**
 * マップ領域幅からカード幅を実測計算する。
 * 横最大 4 列（プロジェクト + L1 + L2 + L3）で画面を埋める。
 * CSS の % だけだとネスト flex で縮むため JS で固定 px を書き込む。
 */
const mapScrollRef = ref<HTMLElement | null>(null)
let mapResizeObserver: ResizeObserver | null = null

const MM_COLS = 4
const MM_LINK = 28
const MM_RAIL = 22
const MM_SIBLING_GAP = 16

function applyMapMetrics() {
  const el = mapScrollRef.value
  if (!el) return
  const cs = getComputedStyle(el)
  const padX =
    (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  const available = Math.max(0, el.clientWidth - padX)
  const segment = MM_LINK + MM_RAIL
  const segs = (MM_COLS - 1) * segment
  const raw = Math.floor((available - segs) / MM_COLS)
  // 横長 3:1 を保つため幅の下限をやや高めに
  const cardW = Math.max(240, Math.min(raw, 560))
  const leafH = Math.round(cardW / 3)
  el.style.setProperty('--mm-card-w', `${cardW}px`)
  el.style.setProperty('--mm-leaf-h', `${leafH}px`)
  el.style.setProperty('--mm-link', `${MM_LINK}px`)
  el.style.setProperty('--mm-rail', `${MM_RAIL}px`)
  el.style.setProperty('--mm-sibling-gap', `${MM_SIBLING_GAP}px`)
}

function bindMapResizeObserver() {
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
  const el = mapScrollRef.value
  if (!el) return
  applyMapMetrics()
  if (typeof ResizeObserver === 'undefined') return
  mapResizeObserver = new ResizeObserver(() => applyMapMetrics())
  mapResizeObserver.observe(el)
}

const activeTasks = computed(() => tasksStore.activeTasks)

const roots = computed(() =>
  childrenOf(activeTasks.value, null, 'asc', 'wbs'),
)

const rootCount = computed(() => roots.value.length)
const totalCount = computed(() => activeTasks.value.length)

/** MM/DD（マインドマップと同じ短縮表記） */
function shortMd(iso?: string | null): string {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  if (d.length < 10) return d
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`
}

/**
 * 左端プロジェクトカード用の集計
 * 幅はタスクカードと同じ、高さで詳細サマリを載せる
 */
const projectOverview = computed(() => {
  const tasks = activeTasks.value
  const project = projectsStore.currentProject
  const total = tasks.length
  const leafTasks = tasks.filter((t) => !hasChildren(t, tasks))
  const leafCount = leafTasks.length
  const parentCount = total - leafCount

  const statusCounts = {} as Record<TaskStatus, number>
  for (const s of TASK_STATUSES) statusCounts[s] = 0
  for (const t of tasks) {
    if (statusCounts[t.status] != null) statusCounts[t.status] += 1
  }

  // 葉の進捗平均（実行単位の全体感）
  let progSum = 0
  for (const t of leafTasks) {
    progSum += normalizeCompletion(displaySchedule(t).completionPercent)
  }
  const progress =
    leafCount > 0 ? Math.round(progSum / leafCount) : total === 0 ? 0 : 0

  let estSum = 0
  let actSum = 0
  let hasEst = false
  let hasAct = false
  const starts: string[] = []
  const dues: string[] = []
  for (const t of leafTasks.length ? leafTasks : tasks) {
    const sch = displaySchedule(t)
    if (sch.estimatedEffortDays != null) {
      estSum += Number(sch.estimatedEffortDays)
      hasEst = true
    }
    if (sch.actualEffortDays != null) {
      actSum += Number(sch.actualEffortDays)
      hasAct = true
    }
    if (sch.plannedStartDate) starts.push(sch.plannedStartDate.slice(0, 10))
    if (sch.plannedDueDate) dues.push(sch.plannedDueDate.slice(0, 10))
  }
  starts.sort()
  dues.sort()
  const rangeStart = starts[0]
  const rangeEnd = dues[dues.length - 1]
  let dateRange = ''
  if (rangeStart && rangeEnd) {
    dateRange = `${shortMd(rangeStart)}→${shortMd(rangeEnd)}`
  } else if (rangeStart) {
    dateRange = `${shortMd(rangeStart)}→`
  } else if (rangeEnd) {
    dateRange = `→${shortMd(rangeEnd)}`
  }

  const done = statusCounts['完了'] ?? 0
  const inProgress = statusCounts['進行中'] ?? 0
  const review = statusCounts['レビュー待ち'] ?? 0
  const idle = statusCounts['未着手'] ?? 0
  const hold = statusCounts['保留'] ?? 0

  const memberCount =
    project?.members?.length ??
    project?.memberIds?.length ??
    project?.memberEmails?.length ??
    0

  const pStatus = (project?.status ?? 'active') as ProjectStatus
  const desc = project?.description?.trim() || ''

  return {
    name: project?.name ?? 'プロジェクト',
    description: desc,
    projectStatus: pStatus,
    projectStatusLabel: PROJECT_STATUS_LABELS[pStatus] ?? pStatus,
    projectStatusColor: PROJECT_STATUS_COLORS[pStatus] ?? 'grey',
    total,
    leafCount,
    parentCount,
    rootCount: roots.value.length,
    done,
    inProgress,
    review,
    idle,
    hold,
    progress,
    estSum: hasEst ? Math.round(estSum * 10) / 10 : null as number | null,
    actSum: hasAct ? Math.round(actSum * 10) / 10 : null as number | null,
    dateRange,
    memberCount,
    /** ステータス棒グラフ用（0 は除外） */
    statusBars: TASK_STATUSES.map((s) => ({
      status: s,
      count: statusCounts[s] ?? 0,
      color: STATUS_COLORS[s],
    })).filter((x) => x.count > 0),
  }
})

const showInitialSkeleton = computed(
  () =>
    tasksStore.isLoading &&
    !tasksStore.hasDataForCurrentProject &&
    tasksStore.currentProjectId === projectId.value,
)

function syncExpanded(tasks: Task[]) {
  const parents = collectParentIds(tasks)
  const parentSet = new Set(parents)
  if (!expandedInited.value) {
    expandedIds.value = new Set(parents)
    expandedInited.value = true
    return
  }
  // 既存の展開を維持し、新規親のみ自動展開
  const next = new Set<string>()
  for (const id of expandedIds.value) {
    if (parentSet.has(id)) next.add(id)
  }
  for (const id of parents) {
    if (!expandedIds.value.has(id)) next.add(id)
  }
  expandedIds.value = next
}

function expandAll() {
  expandedIds.value = new Set(collectParentIds(activeTasks.value))
}

function collapseAll() {
  expandedIds.value = new Set()
}

function onToggle(taskId: string) {
  const next = new Set(expandedIds.value)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  expandedIds.value = next
}

function ensureExpanded(taskId: string) {
  if (expandedIds.value.has(taskId)) return
  const next = new Set(expandedIds.value)
  next.add(taskId)
  expandedIds.value = next
}

function openTaskDetail(task: Task) {
  const prepared = prepareTaskForDetail(task, resolveAssigneeDisplayName)
  if (!prepared) return
  tasksStore.currentTask = prepared
  showDetail.value = true
  if (route.query.taskId !== prepared.taskId) {
    void router
      .replace({
        name: 'task-wbs',
        params: { projectId: projectId.value },
        query: { ...route.query, taskId: prepared.taskId },
      })
      .catch(() => {})
  }
}

function openCreateRoot() {
  createParentId.value = null
  showCreateForm.value = true
}

function onAddChild(parent: Task) {
  createParentId.value = parent.taskId
  ensureExpanded(parent.taskId)
  showCreateForm.value = true
}

function onAddSibling(task: Task) {
  createParentId.value = task.parentTaskId ?? null
  showCreateForm.value = true
}

function onOutlineBusy(v: boolean) {
  structureBusy.value = v
}

/** 構成マップの「追加」スロット */
function onCompactAdd(parentTaskId: string | null) {
  createParentId.value = parentTaskId
  if (parentTaskId) ensureExpanded(parentTaskId)
  showCreateForm.value = true
}

/** 構成マップ（未保存の整理を先に保存してから renumber） */
const compactMapRef = ref<{
  saveIfDirty: () => Promise<boolean>
} | null>(null)

async function onRenumber() {
  if (renumbering.value || !projectId.value) return
  if (
    !window.confirm(
      '現在の親子関係と並び順に基づき、WBS 番号を振り直します。よろしいですか？',
    )
  ) {
    return
  }
  renumbering.value = true
  structureBusy.value = true
  try {
    // ローカル整理が未保存なら先に保存
    if (compactMapRef.value?.saveIfDirty) {
      const ok = await compactMapRef.value.saveIfDirty()
      if (!ok) return
    }
    await tasksStore.renumberWbs(projectId.value)
  } finally {
    renumbering.value = false
    structureBusy.value = false
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

watch(showDetail, (open) => {
  if (open) return
  if (!route.query.taskId) return
  const nextQuery = { ...route.query }
  delete nextQuery.taskId
  void router
    .replace({
      name: 'task-wbs',
      params: { projectId: projectId.value },
      query: nextQuery,
    })
    .catch(() => {})
})

async function loadWbs(): Promise<void> {
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
  syncExpanded(tasksStore.activeTasks)
  await openTaskFromQuery()
}

onMounted(() => {
  void loadWbs().then(() => {
    void nextTick(() => bindMapResizeObserver())
  })
})

onBeforeUnmount(() => {
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
})

watch(projectId, () => {
  expandedInited.value = false
  void loadWbs().then(() => {
    void nextTick(() => bindMapResizeObserver())
  })
})

watch(
  () => tasksStore.tasks,
  () => {
    if (tasksStore.currentProjectId === projectId.value) {
      syncExpanded(tasksStore.activeTasks)
      void nextTick(() => applyMapMetrics())
    }
  },
  { deep: true },
)

watch(mapScrollRef, () => {
  void nextTick(() => bindMapResizeObserver())
})

watch(viewMode, (mode) => {
  if (mode === 'map') {
    void nextTick(() => bindMapResizeObserver())
  }
})
</script>

<template>
  <v-container fluid class="py-3 px-2 wbs-page">
    <div class="page-header d-flex align-center flex-wrap ga-3 mb-3">
      <div class="min-w-0">
        <h1 class="text-h6 font-weight-bold mb-0 text-truncate">
          {{ projectsStore.currentProject?.name ?? '構成' }}
        </h1>
        <p class="text-caption text-medium-emphasis mb-0 mt-1">
          <template v-if="viewMode === 'map'">
            詳細マップ · 情報の俯瞰 · 構造編集は「構成マップ」へ
          </template>
          <template v-else>
            構成マップ · ドラッグで階層・並びを編集 → 番号を振り直す
          </template>
        </p>
      </div>
      <v-progress-circular
        v-if="tasksStore.isRefreshing || projectsStore.isRefreshing || renumbering || structureBusy"
        indeterminate
        size="18"
        width="2"
        color="primary"
      />
      <v-spacer />
      <v-chip size="small" variant="tonal" label>
        ルート {{ rootCount }} · 全 {{ totalCount }}
      </v-chip>
    </div>

    <div class="wbs-toolbar d-flex align-center flex-wrap ga-2 mb-3">
      <v-btn-toggle
        v-model="viewMode"
        mandatory
        density="comfortable"
        color="primary"
        rounded="lg"
        divided
        class="wbs-toggle"
      >
        <v-btn size="small" value="map" prepend-icon="mdi-sitemap">
          詳細マップ
        </v-btn>
        <v-btn size="small" value="outline" prepend-icon="mdi-file-tree">
          構成マップ
        </v-btn>
      </v-btn-toggle>

      <template v-if="viewMode === 'map'">
        <v-btn-toggle
          :model-value="null"
          density="comfortable"
          color="primary"
          rounded="lg"
          divided
          class="wbs-toggle"
        >
          <v-btn size="small" value="expand" @click="expandAll">展開</v-btn>
          <v-btn size="small" value="collapse" @click="collapseAll">折りたたみ</v-btn>
        </v-btn-toggle>
      </template>

      <v-btn
        size="small"
        color="primary"
        variant="flat"
        rounded="lg"
        prepend-icon="mdi-plus"
        @click="openCreateRoot"
      >
        ルートを追加
      </v-btn>
      <v-btn
        v-if="viewMode === 'outline'"
        size="small"
        color="primary"
        variant="tonal"
        rounded="lg"
        prepend-icon="mdi-numeric"
        :loading="renumbering"
        :disabled="totalCount === 0 || structureBusy"
        @click="onRenumber"
      >
        番号を振り直す
      </v-btn>
      <v-spacer />
      <span class="text-caption text-medium-emphasis wbs-hint">
        <template v-if="viewMode === 'map'">
          子/同階の追加 · 構造ドラッグは「構成マップ」
        </template>
        <template v-else>
          整理 = ドラッグ後に保存 · 編集 = 追加・削除 · 番号を振り直す
        </template>
      </span>
    </div>

    <v-skeleton-loader v-if="showInitialSkeleton" type="image, list-item@4" />

    <div v-else-if="!roots.length" class="wbs-empty">
      <v-icon size="48" color="medium-emphasis" class="mb-3">mdi-file-tree</v-icon>
      <p class="text-body-1 mb-1">まだ WBS がありません</p>
      <p class="text-caption text-medium-emphasis mb-4">
        ルートタスクを追加して、成果物を分解していきましょう
      </p>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateRoot">
        ルートを追加
      </v-btn>
    </div>

    <!-- 構成マップ（緊凑 mind-map + ガイド + DnD） -->
    <WbsCompactMap
      v-else-if="viewMode === 'outline'"
      ref="compactMapRef"
      :tasks="activeTasks"
      :project-name="projectsStore.currentProject?.name ?? 'プロジェクト'"
      :project-id="projectId"
      :busy="structureBusy"
      @open="openTaskDetail"
      @add="onCompactAdd"
      @busy="onOutlineBusy"
    />

    <div v-else ref="mapScrollRef" class="wbs-map-scroll">
      <div class="wbs-map-canvas">
        <!-- 仮想ルート: プロジェクト（幅固定・縦にサマリ） -->
        <div class="mm-project-root">
          <div class="mm-project-card" :title="projectOverview.name">
            <div class="mm-proj-head">
              <v-icon size="18" color="primary" class="flex-shrink-0">
                mdi-folder-outline
              </v-icon>
              <span class="mm-project-label">プロジェクト</span>
              <v-chip
                :color="projectOverview.projectStatusColor"
                size="x-small"
                label
                variant="tonal"
                class="mm-proj-status"
              >
                {{ projectOverview.projectStatusLabel }}
              </v-chip>
            </div>
            <div class="mm-project-name">{{ projectOverview.name }}</div>
            <p
              v-if="projectOverview.description"
              class="mm-proj-desc"
              :title="projectOverview.description"
            >
              {{ projectOverview.description }}
            </p>

            <div class="mm-proj-divider" />

            <div class="mm-proj-stats">
              <div class="mm-proj-stat">
                <span class="mm-proj-stat-val">{{ projectOverview.total }}</span>
                <span class="mm-proj-stat-lbl">タスク</span>
              </div>
              <div class="mm-proj-stat">
                <span class="mm-proj-stat-val">{{ projectOverview.leafCount }}</span>
                <span class="mm-proj-stat-lbl">葉</span>
              </div>
              <div class="mm-proj-stat">
                <span class="mm-proj-stat-val">{{ projectOverview.rootCount }}</span>
                <span class="mm-proj-stat-lbl">ルート</span>
              </div>
              <div class="mm-proj-stat">
                <span class="mm-proj-stat-val">{{ projectOverview.memberCount }}</span>
                <span class="mm-proj-stat-lbl">メンバ</span>
              </div>
            </div>

            <div class="mm-proj-status-row">
              <span class="mm-proj-pill">完了 {{ projectOverview.done }}</span>
              <span class="mm-proj-pill is-prog">進行 {{ projectOverview.inProgress }}</span>
              <span v-if="projectOverview.review" class="mm-proj-pill is-rev">
                レビュー {{ projectOverview.review }}
              </span>
              <span class="mm-proj-pill is-idle">未着手 {{ projectOverview.idle }}</span>
              <span v-if="projectOverview.hold" class="mm-proj-pill is-hold">
                保留 {{ projectOverview.hold }}
              </span>
            </div>

            <!-- ステータス内訳バー -->
            <div
              v-if="projectOverview.total > 0"
              class="mm-proj-stack-bar"
              :title="projectOverview.statusBars.map((b) => `${b.status} ${b.count}`).join(' · ')"
            >
              <div
                v-for="bar in projectOverview.statusBars"
                :key="bar.status"
                class="mm-proj-stack-seg"
                :style="{
                  flex: bar.count,
                  background: `rgb(var(--v-theme-${bar.color}))`,
                }"
              />
            </div>

            <div class="mm-proj-progress">
              <v-progress-linear
                :model-value="projectOverview.progress"
                color="#ec407a"
                height="5"
                rounded
                class="flex-grow-1 mm-proj-progress-bar"
              />
              <span class="mm-proj-prog-val">{{ projectOverview.progress }}%</span>
            </div>
            <div class="mm-proj-caption">葉タスク平均進捗</div>

            <div class="mm-proj-meta">
              <div class="mm-proj-meta-line">
                <v-icon size="13">mdi-calendar-range</v-icon>
                <span v-if="projectOverview.dateRange">{{ projectOverview.dateRange }}</span>
                <span v-else class="is-empty">日程未設定</span>
              </div>
              <div class="mm-proj-meta-line">
                <v-icon size="13">mdi-clock-outline</v-icon>
                <span v-if="projectOverview.estSum != null || projectOverview.actSum != null">
                  <template v-if="projectOverview.estSum != null">
                    予{{ projectOverview.estSum }}
                  </template>
                  <template v-if="projectOverview.actSum != null">
                    <template v-if="projectOverview.estSum != null"> · </template>
                    実{{ projectOverview.actSum }}
                  </template>
                </span>
                <span v-else class="is-empty">工数 —</span>
              </div>
            </div>
          </div>
          <div class="mm-project-branch">
            <div class="mm-project-h" aria-hidden="true" />
            <div class="mm-project-children">
              <div
                v-for="(root, index) in roots"
                :key="root.taskId"
                class="mm-project-child"
                :class="{
                  'is-first': index === 0,
                  'is-last': index === roots.length - 1,
                  'is-only': roots.length === 1,
                }"
              >
                <WbsMindMapNode
                  :task="root"
                  :all-tasks="activeTasks"
                  :depth="0"
                  :expanded-ids="expandedIds"
                  :busy="structureBusy"
                  @open="openTaskDetail"
                  @toggle="onToggle"
                  @add-child="onAddChild"
                  @add-sibling="onAddSibling"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <TaskDetail v-model="showDetail" :project-id="projectId" />
    <TaskForm
      v-model="showCreateForm"
      :project-id="projectId"
      :default-parent-task-id="createParentId ?? undefined"
    />
  </v-container>
</template>

<style scoped>
.wbs-page {
  max-width: 100%;
  /* フォールバック（JS 計測前） */
  --mm-card-w: 280px;
  --mm-leaf-h: 93px;
  --mm-link: 28px;
  --mm-rail: 22px;
  --mm-sibling-gap: 16px;
}
.min-w-0 {
  min-width: 0;
}
.wbs-toolbar {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.wbs-toggle :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0.01em;
}
.wbs-hint {
  max-width: 480px;
  line-height: 1.35;
}
.wbs-empty {
  text-align: center;
  padding: 64px 16px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.wbs-map-scroll {
  overflow: auto;
  max-height: calc(100vh - 200px);
  width: 100%;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
  background:
    radial-gradient(
      circle at 20% 20%,
      rgba(var(--v-theme-primary), 0.04),
      transparent 45%
    ),
    rgb(var(--v-theme-surface));
  padding: 20px 16px;
  box-sizing: border-box;
}
.wbs-map-canvas {
  /* 4 列分の実幅を確保（縮めない） */
  width: max(
    100%,
    calc(4 * var(--mm-card-w) + 3 * (var(--mm-link) + var(--mm-rail)))
  );
  min-height: 240px;
  display: flex;
  align-items: flex-start;
}

/* プロジェクト仮想ルート */
.mm-project-root {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.mm-project-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: var(--mm-card-w);
  min-width: var(--mm-card-w);
  max-width: var(--mm-card-w);
  /* 幅はタスクと同じ・高さはサマリ用に伸ばす */
  height: auto;
  min-height: calc(var(--mm-leaf-h) * 2.4);
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 12px 12px 10px;
  border-radius: 12px;
  background: linear-gradient(
    160deg,
    rgba(var(--v-theme-primary), 0.16),
    rgba(var(--v-theme-primary), 0.04) 55%,
    rgb(var(--v-theme-surface))
  );
  border: 2px solid rgba(var(--v-theme-primary), 0.4);
  box-shadow: 0 3px 12px rgba(var(--v-theme-primary), 0.1);
  z-index: 2;
}
.mm-proj-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.mm-project-label {
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.5);
  flex: 1;
  min-width: 0;
}
.mm-proj-status {
  flex-shrink: 0;
  height: 18px !important;
  font-size: 0.6rem !important;
}
.mm-project-name {
  font-size: 0.95rem;
  font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.92);
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.mm-proj-desc {
  margin: 6px 0 0;
  font-size: 0.7rem;
  line-height: 1.35;
  color: rgba(var(--v-theme-on-surface), 0.55);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mm-proj-divider {
  height: 1px;
  margin: 10px 0 8px;
  background: rgba(var(--v-theme-primary), 0.18);
}
.mm-proj-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 8px;
}
.mm-proj-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 2px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.mm-proj-stat-val {
  font-size: 0.95rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.88);
  line-height: 1.2;
}
.mm-proj-stat-lbl {
  font-size: 0.58rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  letter-spacing: 0.02em;
}
.mm-proj-status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.mm-proj-pill {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-success), 0.12);
  color: rgb(var(--v-theme-success));
  font-variant-numeric: tabular-nums;
}
.mm-proj-pill.is-prog {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.mm-proj-pill.is-rev {
  background: rgba(var(--v-theme-warning), 0.14);
  color: rgb(var(--v-theme-warning));
}
.mm-proj-pill.is-idle {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.mm-proj-pill.is-hold {
  background: rgba(var(--v-theme-error), 0.1);
  color: rgb(var(--v-theme-error));
}
.mm-proj-stack-bar {
  display: flex;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 8px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.mm-proj-stack-seg {
  min-width: 2px;
  opacity: 0.85;
}
.mm-proj-progress {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 進捗バーはピンク（上の状態割合バーと区別・甘特 progress と同系） */
.mm-proj-progress-bar :deep(.v-progress-linear__determinate) {
  background-color: #ec407a !important;
}
.mm-proj-prog-val {
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #ec407a;
  min-width: 2.4em;
  text-align: right;
}
.mm-proj-caption {
  font-size: 0.58rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
  margin-bottom: 8px;
}
.mm-proj-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mm-proj-meta-line {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-variant-numeric: tabular-nums;
}
.mm-proj-meta-line .is-empty {
  color: rgba(var(--v-theme-on-surface), 0.36);
  font-weight: 500;
}
.mm-project-branch {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex-shrink: 0;
}
.mm-project-h {
  width: var(--mm-link);
  flex-shrink: 0;
  align-self: center;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.4);
  box-sizing: border-box;
}
/* ルート列: 子ノードと同じレール接続 */
.mm-project-children {
  display: flex;
  flex-direction: column;
  gap: var(--mm-sibling-gap);
  position: relative;
  flex-shrink: 0;
}
.mm-project-child {
  display: flex;
  flex-direction: row;
  align-items: center;
  position: relative;
  padding-left: var(--mm-rail);
  box-sizing: border-box;
}
/* 縦幹 */
.mm-project-child::before {
  content: '';
  position: absolute;
  left: 0;
  border-left: 2px solid rgba(var(--v-theme-primary), 0.35);
  top: calc(var(--mm-sibling-gap) / -2);
  bottom: calc(var(--mm-sibling-gap) / -2);
}
.mm-project-child.is-first::before {
  top: 50%;
}
.mm-project-child.is-last::before {
  bottom: 50%;
}
.mm-project-child.is-only::before {
  display: none;
}
/* 肘 → カード */
.mm-project-child::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: var(--mm-rail);
  border-top: 2px solid rgba(var(--v-theme-primary), 0.35);
}

:deep(.mm-ghost) {
  opacity: 0.4;
}
</style>
