<script setup lang="ts">
/**
 * WBS 対応ガントチャート
 * - 左列: WBS ツリー（幅ドラッグで可変）
 * - 右列: 予定 / 実績 / 両方 の表示切替
 * - リーフ予定バーはドラッグで予定開始日のみ変更（工数リサイズなし）
 * - 日程未設定リーフは日付へ DnD で予定開始日を設定
 */
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import type { Task } from '@/types/task'
import {
  STATUS_COLORS,
  normalizeCompletion,
  getPlannedStartDate,
  getPlannedDueDate,
} from '@/types/task'
import {
  resolveTaskSchedule,
  resolveGanttBarSchedule,
  resolveActualGanttBarSchedule,
  computeTimelineRange,
  shiftScheduleByDays,
  createRestDayPredicate,
  endDateFromWorkingEffort,
  addDays,
  diffCalendarDays,
  formatDateOnly,
  parseDateOnly,
  startOfLocalDay,
  isWeekend,
  WEEKDAY_LABELS,
  type TaskSchedule,
  type GanttDateMode,
} from '@/utils/taskSchedule'
import {
  flattenVisibleTreeWithDepth,
  collectParentIds,
  hasChildren,
  displaySchedule,
  isLeafTask,
  type SiblingSortMode,
} from '@/utils/wbs'
import { resolveAssigneeLabels } from '@/utils/displayName'

const DND_MIME = 'application/x-taskvista-task-id'

const props = defineProps<{
  tasks: Task[]
  /** 休日設定の永続化キー（projectId 推奨） */
  projectId?: string
  /** 開始日を保存中（ドロップ後の二重操作防止） */
  savingStartDate?: boolean
  /** バー移動保存中 */
  savingSchedule?: boolean
}>()

const emit = defineEmits<{
  open: [task: Task]
  /** 未設定タスクをカレンダーにドロップしたときの開始日設定 */
  'set-start-date': [
    payload: { taskId: string; plannedStartDate: string; task: Task },
  ]
  /** リーフ予定バーの移動（予定開始日のみ。工数は維持） */
  'update-schedule': [
    payload: {
      taskId: string
      plannedStartDate: string
      estimatedEffortDays: number
      task: Task
    },
  ]
}>()

/** 1 日あたりの幅（px）— 既定 64、拡大上限はさらに上 */
const dayWidth = ref(64)
const DAY_W_MIN = 28
const DAY_W_MAX = 128
/** 左タスク列幅（px）— ドラッグで変更 */
const labelWidth = ref(280)
const LABEL_W_MIN = 160
const LABEL_W_MAX = 560
const HEADER_H = 56

/**
 * 進捗（既定）/ 予定 / 実績 / 対照
 * 色は status ではなく: 進捗=ピンク、予定=青、実績=緑、深さで濃淡
 */
const dateMode = ref<GanttDateMode>('progress')
const dateModeItems: Array<{ value: GanttDateMode; title: string }> = [
  { value: 'progress', title: '進捗' },
  { value: 'planned', title: '予定' },
  { value: 'actual', title: '実績' },
  { value: 'both', title: '対照' },
]

/**
 * 同階層の並び（WBS 番号は変更しない・表示のみ）
 * 既定: 開始日順（甘特で時間軸と揃える）
 */
const siblingSortMode = ref<SiblingSortMode>('plannedStart')
const siblingSortItems: Array<{ value: SiblingSortMode; title: string }> = [
  { value: 'plannedStart', title: '開始日順' },
  { value: 'wbs', title: 'WBS順' },
]

/** 休日列をカレンダーから隠す（折りたたみ） */
const hideRestColumns = ref(false)

/** 行の高さ（両方表示時は2段でもセルを上下で埋める） */
const rowHeight = computed(() => (dateMode.value === 'both' ? 56 : 44))

interface BarGeom {
  hasBar: boolean
  leftPx: number
  widthPx: number
  /** バー内: 予定/実績工数の数字のみ（例: 0.5） */
  effortText: string
  /** tooltip 用の詳細 */
  detailLabel: string
  schedule: TaskSchedule
}

/** 工数数字（入力値のまま。0.5 → 0.5） */
function formatEffortLabel(durationDays: number | null | undefined): string {
  if (durationDays == null || !Number.isFinite(Number(durationDays))) return ''
  const n = Number(durationDays)
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  const s = (Math.round(n * 100) / 100).toFixed(2)
  return s.replace(/\.?0+$/, '')
}

interface TimelineRow {
  task: Task
  depth: number
  isParent: boolean
  progress: number
  assignees: string
  /** 左列メタ用 */
  plannedEffortText: string
  actualEffortText: string
  planned: BarGeom
  actual: BarGeom
  /** 編集用の元開始日（リーフ・予定バーあり） */
  plannedStartDate: string | null
  estimatedEffortDays: number | null
  /** 予定終了 < 今日 かつ 未完了 */
  isDelayed: boolean
  statusTone: 'done' | 'progress' | 'todo' | 'hold' | 'review'
}

/**
 * 左列タスク名下のメタ行（ビュー別）
 * 進捗: status ｜ 進捗 n%
 * 予定: status ｜ 予 n人日
 * 実績: status ｜ 実 n人日
 * 対照: status ｜ 予 n ｜ 実 n
 */
function labelMetaSegments(row: TimelineRow): string[] {
  const segs: string[] = [row.task.status]
  if (dateMode.value === 'progress') {
    segs.push(`進捗 ${row.progress}%`)
    return segs
  }
  if (dateMode.value === 'planned') {
    if (row.plannedEffortText) segs.push(`予 ${row.plannedEffortText}人日`)
    return segs
  }
  if (dateMode.value === 'actual') {
    if (row.actualEffortText) segs.push(`実 ${row.actualEffortText}人日`)
    return segs
  }
  // 対照
  if (row.plannedEffortText) segs.push(`予 ${row.plannedEffortText}`)
  if (row.actualEffortText) segs.push(`実 ${row.actualEffortText}`)
  return segs
}

// ── 休日（土日既定 + ユーザー上書き）────────────────
/** 平日を休日にした日 YYYY-MM-DD */
const customRestDates = ref<Set<string>>(new Set())
/** 土日を稼働にした日 YYYY-MM-DD */
const customWorkDates = ref<Set<string>>(new Set())

function restStorageKey(): string {
  return `taskvista-gantt-rest:${props.projectId || 'default'}`
}

function loadRestOverrides() {
  try {
    const raw = localStorage.getItem(restStorageKey())
    if (!raw) {
      customRestDates.value = new Set()
      customWorkDates.value = new Set()
      return
    }
    const parsed = JSON.parse(raw) as { rest?: string[]; work?: string[] }
    customRestDates.value = new Set(parsed.rest ?? [])
    customWorkDates.value = new Set(parsed.work ?? [])
  } catch {
    customRestDates.value = new Set()
    customWorkDates.value = new Set()
  }
}

function saveRestOverrides() {
  try {
    localStorage.setItem(
      restStorageKey(),
      JSON.stringify({
        rest: [...customRestDates.value],
        work: [...customWorkDates.value],
      }),
    )
  } catch {
    /* ignore */
  }
}

const isRestDay = computed(() =>
  createRestDayPredicate(customRestDates.value, customWorkDates.value),
)

function isRestDayAt(d: Date): boolean {
  return isRestDay.value(d)
}

/** ヘッダ日付クリック: 休日 ⇔ 稼働 */
function toggleRestDay(d: Date, e?: Event) {
  e?.stopPropagation()
  e?.preventDefault()
  const key = formatDateOnly(d)
  const weekend = isWeekend(d)
  const rest = new Set(customRestDates.value)
  const work = new Set(customWorkDates.value)

  if (weekend) {
    // 既定休日 → 稼働へ / 再度で既定に戻す
    if (work.has(key)) {
      work.delete(key)
    } else {
      work.add(key)
      rest.delete(key)
    }
  } else {
    // 平日 → 休日へ / 再度で稼働に戻す
    if (rest.has(key)) {
      rest.delete(key)
    } else {
      rest.add(key)
      work.delete(key)
    }
  }
  customRestDates.value = rest
  customWorkDates.value = work
  saveRestOverrides()
}

watch(
  () => props.projectId,
  () => {
    loadRestOverrides()
  },
  { immediate: true },
)

// ── 展開状態 ───────────────────────────────────────
const expandedIds = ref<Set<string>>(new Set())
const expandedInited = ref(false)
const knownParentIds = ref<Set<string>>(new Set())

function reinitExpanded(tasks: Task[]) {
  const parents = collectParentIds(tasks)
  const parentSet = new Set(parents)
  const alive = new Set(tasks.map((t) => t.taskId))

  if (!expandedInited.value) {
    expandedIds.value = new Set(parents)
    knownParentIds.value = parentSet
    expandedInited.value = true
    return
  }

  // 既存の展開を維持し、新規親のみデフォルト展開。消滅 id は掃除
  const next = new Set<string>()
  for (const id of expandedIds.value) {
    if (alive.has(id) && parentSet.has(id)) next.add(id)
  }
  for (const id of parents) {
    if (!knownParentIds.value.has(id)) next.add(id)
  }
  expandedIds.value = next
  knownParentIds.value = parentSet
}

watch(
  () => {
    // タスク id 集合 + 親 id 集合の変化で再評価（子追加で新規親になった場合も拾う）
    const ids = props.tasks.map((t) => t.taskId).sort().join('\0')
    const parents = collectParentIds(props.tasks).sort().join('\0')
    return `${ids}|${parents}`
  },
  () => {
    reinitExpanded(props.tasks)
  },
  { immediate: true },
)

function toggleExpand(taskId: string, e?: Event) {
  e?.stopPropagation()
  const next = new Set(expandedIds.value)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  expandedIds.value = next
}

function expandAll() {
  expandedIds.value = new Set(collectParentIds(props.tasks))
}

function collapseAll() {
  expandedIds.value = new Set()
}

// ── ツリー行 ───────────────────────────────────────
const treeRows = computed(() =>
  flattenVisibleTreeWithDepth(
    props.tasks,
    expandedIds.value,
    'asc',
    siblingSortMode.value,
  ),
)

/**
 * 日程未設定（ドラッグで開始日を付ける対象）:
 * リーフ・開始日なし・ステータスが「保留」以外。
 */
const unscheduled = computed(() =>
  props.tasks.filter(
    (t) =>
      isLeafTask(t, props.tasks) &&
      t.status !== '保留' &&
      !resolveTaskSchedule(t, isRestDay.value).hasBar,
  ),
)

/** 開始日なしの保留（ドラッグ対象外） */
const heldWithoutSchedule = computed(() =>
  props.tasks.filter(
    (t) => t.status === '保留' && !resolveTaskSchedule(t, isRestDay.value).hasBar,
  ),
)

const range = computed(() =>
  computeTimelineRange(props.tasks, 3, dateMode.value, isRestDay.value),
)

/** 休日設定 / 折りたたみが変わったらバー再計算 */
const restRevision = computed(
  () =>
    `${[...customRestDates.value].sort().join(',')}|${[...customWorkDates.value].sort().join(',')}|${hideRestColumns.value}`,
)

/** レンジ内の全日（休日含む） */
const allDays = computed(() => {
  const list: Date[] = []
  let d = range.value.rangeStart
  for (let i = 0; i < range.value.totalDays; i++) {
    list.push(d)
    d = addDays(d, 1)
  }
  return list
})

/**
 * 画面に出す日列（休日折りたたみ時は休日を除く）
 * 以降の days / ヘッダ / バー座標はすべてこちら基準
 */
const days = computed(() => {
  void restRevision.value
  if (!hideRestColumns.value) return allDays.value
  return allDays.value.filter((d) => !isRestDayAt(d))
})

const restDayCount = computed(
  () => allDays.value.filter((d) => isRestDayAt(d)).length,
)

/**
 * 表示日列上で開始〜終了（含む）をセル塗りつぶし座標に変換
 * 休日折りたたみ時: 休日列をスキップしたインデックスで配置
 */
function layoutSpanOnDisplayDays(
  start: Date,
  endInclusive: Date,
): { leftPx: number; widthPx: number } | null {
  const vis = days.value
  if (!vis.length) return null
  const s0 = startOfLocalDay(start).getTime()
  const e0 = startOfLocalDay(endInclusive).getTime()

  // 開始: 開始日そのもの、なければそれ以降の最初の表示日
  let si = vis.findIndex((d) => d.getTime() === s0)
  if (si < 0) si = vis.findIndex((d) => d.getTime() >= s0)

  // 終了: 終了日そのもの、なければそれ以前の最後の表示日
  let ei = -1
  for (let i = vis.length - 1; i >= 0; i--) {
    if (vis[i]!.getTime() === e0) {
      ei = i
      break
    }
  }
  if (ei < 0) {
    for (let i = vis.length - 1; i >= 0; i--) {
      if (vis[i]!.getTime() <= e0) {
        ei = i
        break
      }
    }
  }

  if (si < 0 || ei < 0) return null
  if (ei < si) ei = si

  return {
    leftPx: si * dayWidth.value,
    widthPx: Math.max(1, ei - si + 1) * dayWidth.value,
  }
}

function geomFromSchedule(
  schedule: TaskSchedule,
  effortOverride?: number | null,
): BarGeom {
  if (!schedule.hasBar || !schedule.start) {
    return {
      hasBar: false,
      leftPx: 0,
      widthPx: 0,
      effortText: '',
      detailLabel: '',
      schedule,
    }
  }
  void restRevision.value
  const endDay =
    schedule.endInclusive ?? schedule.anchorDue ?? schedule.start
  const layout = layoutSpanOnDisplayDays(schedule.start, endDay)
  if (!layout) {
    return {
      hasBar: false,
      leftPx: 0,
      widthPx: 0,
      effortText: '',
      detailLabel: '',
      schedule,
    }
  }
  const duration =
    effortOverride != null && effortOverride > 0
      ? effortOverride
      : schedule.durationDays > 0
        ? schedule.durationDays
        : null
  const effortText = formatEffortLabel(duration)
  const startStr = schedule.start.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  })
  const endStr = endDay
    ? endDay.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : ''
  return {
    hasBar: true,
    leftPx: layout.leftPx,
    widthPx: layout.widthPx,
    effortText,
    detailLabel: endStr
      ? `${startStr}〜${endStr}${effortText ? ` · 工数 ${effortText}人日` : ''}`
      : `${startStr}${effortText ? ` · 工数 ${effortText}人日` : ''}`,
    schedule,
  }
}

const monthSpans = computed(() => {
  const spans: { label: string; startIndex: number; days: number }[] = []
  let i = 0
  while (i < days.value.length) {
    const d = days.value[i]!
    let count = 1
    while (
      i + count < days.value.length &&
      days.value[i + count]!.getFullYear() === d.getFullYear() &&
      days.value[i + count]!.getMonth() === d.getMonth()
    ) {
      count++
    }
    spans.push({
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      startIndex: i,
      days: count,
    })
    i += count
  }
  return spans
})

const chartWidth = computed(() => days.value.length * dayWidth.value)
const today = computed(() => startOfLocalDay(new Date()))

const todayIndex = computed(() => {
  const t = today.value.getTime()
  const idx = days.value.findIndex((d) => d.getTime() === t)
  if (idx >= 0) return idx
  // 休日折りたたみで今日が隠れている場合は次の表示日
  if (hideRestColumns.value) {
    const next = days.value.findIndex((d) => d.getTime() > t)
    return next >= 0 ? next : null
  }
  return null
})

const todayOffsetPx = computed(() => {
  if (todayIndex.value == null) return null
  return todayIndex.value * dayWidth.value + dayWidth.value / 2
})

const weekendIndices = computed(() => {
  const set = new Set<number>()
  days.value.forEach((d, i) => {
    if (isWeekend(d)) set.add(i)
  })
  return set
})

/** 進捗ビュー: 予定の位置に進捗塗り */
const showProgress = computed(() => dateMode.value === 'progress')
/** 予定日ビュー or 両方の上段 */
const showPlanned = computed(
  () => dateMode.value === 'planned' || dateMode.value === 'both',
)
/** 実績日ビュー or 両方の下段 */
const showActual = computed(
  () => dateMode.value === 'actual' || dateMode.value === 'both',
)
/** 予定幾何を使うモード（進捗・予定・両方） */
const usesPlannedGeometry = computed(
  () =>
    dateMode.value === 'progress' ||
    dateMode.value === 'planned' ||
    dateMode.value === 'both',
)

const barCount = computed(() => {
  let n = 0
  for (const r of rows.value) {
    if (showPlanned.value && r.planned.hasBar) n++
    if (showActual.value && r.actual.hasBar) n++
  }
  return n
})

function statusToneOf(task: Task, isParent: boolean): TimelineRow['statusTone'] {
  const st =
    isParent && task.rollup?.status ? task.rollup.status : task.status
  if (st === '完了') return 'done'
  if (st === '進行中') return 'progress'
  if (st === 'レビュー待ち') return 'review'
  if (st === '保留') return 'hold'
  return 'todo'
}

function isTaskDelayed(task: Task, isParent: boolean, due: Date | null): boolean {
  if (!due) return false
  const st =
    isParent && task.rollup?.status ? task.rollup.status : task.status
  if (st === '完了') return false
  // 予定終了日 < 今日（当日は遅延にしない）
  return due.getTime() < today.value.getTime()
}

const rows = computed<TimelineRow[]>(() => {
  void restRevision.value
  const restFn = isRestDay.value
  return treeRows.value.map(({ task, depth }) => {
    const isParent = hasChildren(task, props.tasks)
    const plannedSched = resolveGanttBarSchedule(task, restFn)
    const actualSched = resolveActualGanttBarSchedule(task, restFn)
    const disp = displaySchedule(task)

    const plannedEffort =
      disp.estimatedEffortDays != null
        ? disp.estimatedEffortDays
        : task.estimatedEffortDays != null
          ? Number(task.estimatedEffortDays)
          : plannedSched.durationDays > 0
            ? plannedSched.durationDays
            : null
    const actualEffort =
      disp.actualEffortDays != null
        ? disp.actualEffortDays
        : task.actualEffortDays != null
          ? Number(task.actualEffortDays)
          : actualSched.durationDays > 0
            ? actualSched.durationDays
            : null

    const planned = geomFromSchedule(plannedSched, plannedEffort)
    const actual = geomFromSchedule(actualSched, actualEffort)

    const dueDate = parseDateOnly(
      isParent ? disp.plannedDueDate : getPlannedDueDate(task),
    )

    const plannedStart = getPlannedStartDate(task) ?? null
    const leafEffort =
      task.estimatedEffortDays != null &&
      !Number.isNaN(Number(task.estimatedEffortDays)) &&
      Number(task.estimatedEffortDays) > 0
        ? Number(task.estimatedEffortDays)
        : planned.hasBar
          ? planned.schedule.durationDays
          : null

    const progress = normalizeCompletion(
      isParent && task.rollup
        ? task.rollup.completionPercent
        : task.completionPercent,
    )

    return {
      task,
      depth,
      isParent,
      progress,
      assignees: resolveAssigneeLabels(task).join('、') || '未割り当て',
      plannedEffortText: formatEffortLabel(plannedEffort),
      actualEffortText: formatEffortLabel(actualEffort),
      planned,
      actual,
      plannedStartDate: isParent ? null : plannedStart,
      estimatedEffortDays: isParent ? null : leafEffort,
      isDelayed: isTaskDelayed(task, isParent, dueDate),
      statusTone: statusToneOf(task, isParent),
    }
  })
})

/** 予定バー移動プレビュー */
const dragPreview = ref<{
  taskId: string
  leftPx: number
  widthPx: number
  effortText: string
  plannedStartDate: string
  estimatedEffortDays: number
} | null>(null)

function plannedBarStyle(row: TimelineRow): { left: string; width: string } {
  if (dragPreview.value && dragPreview.value.taskId === row.task.taskId) {
    return {
      left: `${dragPreview.value.leftPx}px`,
      width: `${dragPreview.value.widthPx}px`,
    }
  }
  return {
    left: `${row.planned.leftPx}px`,
    width: `${row.planned.widthPx}px`,
  }
}

function plannedEffortText(row: TimelineRow): string {
  if (dragPreview.value && dragPreview.value.taskId === row.task.taskId) {
    return dragPreview.value.effortText
  }
  return row.planned.effortText
}

function actualBarStyle(row: TimelineRow): { left: string; width: string } {
  return {
    left: `${row.actual.leftPx}px`,
    width: `${row.actual.widthPx}px`,
  }
}

function dayHeaderClass(d: Date, index: number): string {
  const classes: string[] = ['day-h']
  if (isWeekend(d)) classes.push('is-weekend')
  if (todayIndex.value === index) classes.push('is-today')
  if (d.getDay() === 0) classes.push('is-sun')
  if (d.getDay() === 6) classes.push('is-sat')
  return classes.join(' ')
}

/** 深さ 0/1/2+ で色の濃淡（主タスクが最も濃い） */
function depthClass(depth: number): string {
  if (depth <= 0) return 'depth-0'
  if (depth === 1) return 'depth-1'
  return 'depth-2'
}

/** 進捗ビュー用バー */
function progressBarClass(row: TimelineRow): string {
  const parts = ['bar', 'bar-progress-view', depthClass(row.depth)]
  if (row.isParent) parts.push('bar-summary')
  if (row.isDelayed) parts.push('is-delayed')
  return parts.join(' ')
}

/** 予定日ビュー用バー（青系・深さで濃淡） */
function plannedBarClass(row: TimelineRow): string {
  const parts = ['bar', 'bar-planned', depthClass(row.depth)]
  if (row.isParent) parts.push('bar-summary')
  if (row.isDelayed) parts.push('is-delayed')
  return parts.join(' ')
}

/** 実績日ビュー用バー（緑系・深さで濃淡） */
function actualBarClass(row: TimelineRow): string {
  const parts = ['bar', 'bar-actual', depthClass(row.depth)]
  if (row.isParent) parts.push('bar-summary')
  if (row.isDelayed) parts.push('is-delayed')
  return parts.join(' ')
}

function zoomIn() {
  dayWidth.value = Math.min(DAY_W_MAX, dayWidth.value + 4)
}
function zoomOut() {
  dayWidth.value = Math.max(DAY_W_MIN, dayWidth.value - 4)
}

const scrollerRef = ref<HTMLElement | null>(null)

function scrollToToday() {
  const el = scrollerRef.value
  if (!el || todayOffsetPx.value == null) return
  const target = todayOffsetPx.value - (el.clientWidth - labelWidth.value) / 2
  el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
}

watch(
  () => [rows.value.length, dayWidth.value, props.tasks.length] as const,
  async () => {
    await nextTick()
    const el = scrollerRef.value
    if (!el || todayOffsetPx.value == null) return
    if (el.scrollLeft === 0) {
      const target =
        todayOffsetPx.value - (el.clientWidth - labelWidth.value) / 2
      el.scrollLeft = Math.max(0, target)
    }
  },
  { flush: 'post' },
)

// ── 左列幅ドラッグ ─────────────────────────────────
const labelResizing = ref(false)

function onLabelResizePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()
  const startX = e.clientX
  const startW = labelWidth.value
  labelResizing.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)

  const onMove = (ev: PointerEvent) => {
    const next = startW + (ev.clientX - startX)
    labelWidth.value = Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, next))
  }
  const onUp = () => {
    labelResizing.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

onMounted(async () => {
  await nextTick()
  scrollToToday()
})

function openTask(task: Task) {
  if (suppressClick.value) {
    suppressClick.value = false
    return
  }
  emit('open', task)
}

// ── 未設定 DnD ─────────────────────────────────────
const draggingTaskId = ref<string | null>(null)
const hoverDayIndex = ref<number | null>(null)
/** ドラッグ直後の click を無視 */
const suppressClick = ref(false)

const draggingTask = computed(() => {
  if (!draggingTaskId.value) return null
  return props.tasks.find((t) => t.taskId === draggingTaskId.value) ?? null
})

function onUnscheduledDragStart(e: DragEvent, task: Task) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(DND_MIME, task.taskId)
  e.dataTransfer.setData('text/plain', task.taskId)
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.dropEffect = 'copy'
  const id = task.taskId
  window.setTimeout(() => {
    draggingTaskId.value = id
  }, 0)
}

function onUnscheduledDragEnd() {
  draggingTaskId.value = null
  hoverDayIndex.value = null
  suppressClick.value = true
  window.setTimeout(() => {
    suppressClick.value = false
  }, 120)
}

const isDragMode = computed(() => !!draggingTaskId.value)

function onDayDragOver(e: DragEvent, dayIndex: number) {
  if (!draggingTaskId.value && !hasTaskDrag(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  hoverDayIndex.value = dayIndex
}

function onDayDragLeave(dayIndex: number) {
  if (hoverDayIndex.value === dayIndex) {
    hoverDayIndex.value = null
  }
}

function hasTaskDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types) return !!draggingTaskId.value
  const list = Array.from(types as ArrayLike<string>)
  return (
    list.includes(DND_MIME) ||
    list.includes('text/plain') ||
    !!draggingTaskId.value
  )
}

function dayIndexFromTrackEvent(e: DragEvent, trackEl: HTMLElement): number | null {
  const rect = trackEl.getBoundingClientRect()
  const x = e.clientX - rect.left
  if (x < 0) return null
  const idx = Math.floor(x / dayWidth.value)
  if (idx < 0 || idx >= days.value.length) return null
  return idx
}



function onTrackDragOver(e: DragEvent) {
  if (!hasTaskDrag(e) && !draggingTaskId.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  const el = e.currentTarget as HTMLElement
  const idx = dayIndexFromTrackEvent(e, el)
  hoverDayIndex.value = idx
}

function onTrackDragLeave(e: DragEvent) {
  const related = e.relatedTarget as Node | null
  if (related && (e.currentTarget as HTMLElement).contains(related)) return
  hoverDayIndex.value = null
}

function resolveDragTaskId(e: DragEvent): string | null {
  const fromMime = e.dataTransfer?.getData(DND_MIME)
  if (fromMime) return fromMime
  const fromText = e.dataTransfer?.getData('text/plain')
  if (fromText) return fromText
  return draggingTaskId.value
}

function applyStartDateDrop(dayIndex: number, e?: DragEvent) {
  if (props.savingStartDate) return
  const taskId = e ? resolveDragTaskId(e) : draggingTaskId.value
  if (!taskId) return
  const day = days.value[dayIndex]
  if (!day) return
  const task = props.tasks.find((t) => t.taskId === taskId)
  if (!task) return
  if (task.plannedStartDate || task.startDate) return
  if (hasChildren(task, props.tasks)) return

  const plannedStartDate = formatDateOnly(day)
  emit('set-start-date', { taskId, plannedStartDate, task })
  draggingTaskId.value = null
  hoverDayIndex.value = null
  suppressClick.value = true
}

function onDropDay(e: DragEvent, dayIndex: number) {
  e.preventDefault()
  e.stopPropagation()
  applyStartDateDrop(dayIndex, e)
}

function onDropTrack(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as HTMLElement
  const idx = dayIndexFromTrackEvent(e, el)
  if (idx == null) return
  applyStartDateDrop(idx, e)
}

function hoverDayLabel(index: number | null): string {
  if (index == null) return ''
  const d = days.value[index]
  if (!d) return ''
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  })
}

// ── リーフ予定バー: ドラッグで予定開始日のみ変更（工数リサイズなし） ──
interface BarDragState {
  task: Task
  pointerId: number
  startClientX: number
  origStart: string
  origEffort: number
  lastStart: string
  lastEffort: number
  moved: boolean
}

const barDrag = ref<BarDragState | null>(null)

function applyPreview(
  taskId: string,
  plannedStartDate: string,
  estimatedEffortDays: number,
  anchorDue?: Date | null,
) {
  const start = parseDateOnly(plannedStartDate)
  if (!start) return
  const effort =
    estimatedEffortDays > 0 ? estimatedEffortDays : 1
  const endInclusive =
    anchorDue && anchorDue.getTime() >= start.getTime()
      ? startOfLocalDay(anchorDue)
      : endDateFromWorkingEffort(start, effort, isRestDay.value)
  const layout = layoutSpanOnDisplayDays(start, endInclusive)
  if (!layout) return
  dragPreview.value = {
    taskId,
    leftPx: layout.leftPx,
    widthPx: layout.widthPx,
    effortText: formatEffortLabel(effort),
    plannedStartDate,
    estimatedEffortDays: effort,
  }
}

function onPlannedBarPointerDown(e: PointerEvent, row: TimelineRow) {
  if (row.isParent || !row.planned.hasBar) return
  // 進捗・予定ビューで開始日ドラッグ可（実績のみのときは不可）
  if (!usesPlannedGeometry.value || dateMode.value === 'actual') return
  if (props.savingSchedule) return
  if (e.button !== 0) return
  e.preventDefault()
  e.stopPropagation()

  const start =
    row.plannedStartDate ||
    (row.planned.schedule.start
      ? formatDateOnly(row.planned.schedule.start)
      : null)
  if (!start) return
  const effort =
    row.estimatedEffortDays != null && row.estimatedEffortDays > 0
      ? row.estimatedEffortDays
      : 1

  barDrag.value = {
    task: row.task,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    origStart: start,
    origEffort: effort,
    lastStart: start,
    lastEffort: effort,
    moved: false,
  }
  applyPreview(
    row.task.taskId,
    start,
    effort,
    row.planned.schedule.anchorDue,
  )
}

function onBarPointerMove(e: PointerEvent) {
  const st = barDrag.value
  if (!st || e.pointerId !== st.pointerId) return

  const dx = e.clientX - st.startClientX
  const deltaDays = Math.round(dx / dayWidth.value)
  if (deltaDays !== 0) st.moved = true

  const r = shiftScheduleByDays(st.origStart, st.origEffort, deltaDays)
  st.lastStart = r.plannedStartDate
  st.lastEffort = r.estimatedEffortDays
  // 移動中は終了日アンカーを外し、開始+工数の素直な幅にする
  applyPreview(st.task.taskId, r.plannedStartDate, r.estimatedEffortDays, null)
}

function finishBarDrag(e: PointerEvent) {
  const st = barDrag.value
  if (!st || e.pointerId !== st.pointerId) return

  const changed =
    st.moved &&
    (st.lastStart !== st.origStart || st.lastEffort !== st.origEffort)

  if (changed) {
    suppressClick.value = true
    window.setTimeout(() => {
      suppressClick.value = false
    }, 150)
    emit('update-schedule', {
      taskId: st.task.taskId,
      plannedStartDate: st.lastStart,
      estimatedEffortDays: st.lastEffort,
      task: st.task,
    })
  }

  barDrag.value = null
  dragPreview.value = null
}

function onWindowPointerMove(e: PointerEvent) {
  if (!barDrag.value) return
  onBarPointerMove(e)
}

function onWindowPointerUp(e: PointerEvent) {
  if (!barDrag.value) return
  finishBarDrag(e)
}

onMounted(() => {
  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('pointercancel', onWindowPointerUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('pointercancel', onWindowPointerUp)
})

const cssVars = computed(() => ({
  '--label-w': `${labelWidth.value}px`,
  '--day-w': `${dayWidth.value}px`,
  '--row-h': `${rowHeight.value}px`,
  '--header-h': `${HEADER_H}px`,
  '--chart-w': `${chartWidth.value}px`,
}))
</script>

<template>
  <div class="tl" :style="cssVars">
    <!-- ツールバー -->
    <div class="tl-toolbar">
      <div class="tl-stats">
        <v-chip size="small" variant="flat" color="primary" class="font-weight-medium">
          {{ rows.length }} 行 · バー {{ barCount }}
        </v-chip>
        <span class="tl-stat-text">
          {{ days[0]?.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) }}
          〜
          {{
            days[days.length - 1]?.toLocaleDateString('ja-JP', {
              month: 'short',
              day: 'numeric',
            })
          }}
          （{{ days.length }}日
          <template v-if="hideRestColumns && restDayCount > 0"
            >· 休{{ restDayCount }}非表示</template
          >）
        </span>
        <v-chip
          v-if="unscheduled.length"
          size="small"
          variant="tonal"
          color="warning"
        >
          日程未設定 {{ unscheduled.length }}
        </v-chip>
      </div>
      <div class="tl-actions">
        <!-- 並び: 開始日順 / WBS順 -->
        <v-btn-toggle
          v-model="siblingSortMode"
          mandatory
          density="comfortable"
          color="primary"
          rounded="lg"
          divided
          class="toolbar-toggle"
        >
          <v-btn
            v-for="opt in siblingSortItems"
            :key="opt.value"
            :value="opt.value"
            size="small"
          >
            {{ opt.title }}
          </v-btn>
        </v-btn-toggle>

        <!-- 表示: 進捗 / 予定 / 実績 / 対照 -->
        <v-btn-toggle
          v-model="dateMode"
          mandatory
          density="comfortable"
          color="primary"
          rounded="lg"
          divided
          class="toolbar-toggle"
        >
          <v-btn
            v-for="opt in dateModeItems"
            :key="opt.value"
            :value="opt.value"
            size="small"
          >
            {{ opt.title }}
          </v-btn>
        </v-btn-toggle>

        <!-- 休日列の表示/隠す -->
        <v-btn-toggle
          v-model="hideRestColumns"
          mandatory
          density="comfortable"
          color="primary"
          rounded="lg"
          divided
          class="toolbar-toggle"
          :disabled="restDayCount === 0 && !hideRestColumns"
        >
          <v-btn :value="false" size="small" title="休日列を表示">
            休日表示
          </v-btn>
          <v-btn :value="true" size="small" title="休日列を折りたたんで非表示">
            休日隠す
          </v-btn>
        </v-btn-toggle>

        <!-- 展開 / 折りたたみ -->
        <v-btn-toggle
          :model-value="null"
          density="comfortable"
          color="primary"
          rounded="lg"
          divided
          class="toolbar-toggle"
        >
          <v-btn size="small" value="expand" title="すべて展開" @click="expandAll">
            展開
          </v-btn>
          <v-btn
            size="small"
            value="collapse"
            title="すべて折りたたみ"
            @click="collapseAll"
          >
            折りたたみ
          </v-btn>
        </v-btn-toggle>

        <!-- 今日（単独） -->
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          rounded="lg"
          class="toolbar-solo-btn"
          title="今日へスクロール"
          @click="scrollToToday"
        >
          今日
        </v-btn>

        <!-- 日幅ズーム（コンパクト・色変化なし） -->
        <div class="zoom-group">
          <v-btn
            size="x-small"
            variant="text"
            icon
            density="comfortable"
            :disabled="dayWidth <= DAY_W_MIN"
            title="日幅を狭く"
            class="zoom-icon-btn"
            @click="zoomOut"
          >
            <v-icon size="16">mdi-minus</v-icon>
          </v-btn>
          <span class="zoom-label">{{ dayWidth }}px</span>
          <v-btn
            size="x-small"
            variant="text"
            icon
            density="comfortable"
            :disabled="dayWidth >= DAY_W_MAX"
            title="日幅を広く"
            class="zoom-icon-btn"
            @click="zoomIn"
          >
            <v-icon size="16">mdi-plus</v-icon>
          </v-btn>
        </div>
      </div>
    </div>

    <!-- 凡例 -->
    <div v-if="!isDragMode" class="tl-legend">
      <span>
        <i class="lg-swatch lg-progress" />
        進捗（ピンク・塗り=進捗%）
      </span>
      <span>
        <i class="lg-swatch lg-planned-shell" />
        予定（青・層で濃淡）
      </span>
      <span>
        <i class="lg-swatch lg-actual" />
        実績（緑・層で濃淡）
      </span>
      <span>
        <i class="lg-swatch lg-delayed" />
        遅延
      </span>
      <span><i class="lg-line lg-today-line" />今日</span>
      <span class="lg-note">並び: 開始日順（既定）/ WBS順 · 番号は変更なし</span>
      <span class="lg-note">「休日を隠す」で休日列を折りたたみ</span>
      <span class="lg-note">日付ヘッダをクリックで休日設定</span>
    </div>
    <div v-else class="tl-drag-banner">
      <v-icon size="20" color="primary" class="mr-2">mdi-calendar-cursor</v-icon>
      <span>
        <strong>予定開始日を設定中</strong>
        — 下の日付を選んでください
        <template v-if="draggingTask && hoverDayIndex != null">
          ：「{{ draggingTask.title }}」→
          <strong>{{ hoverDayLabel(hoverDayIndex) }}</strong>
        </template>
      </span>
    </div>

    <!-- 未スケジュール -->
    <div
      v-if="unscheduled.length"
      class="tl-unscheduled"
      :class="{ 'is-dragging': isDragMode }"
    >
      <div class="unscheduled-title">
        <v-icon size="18" class="mr-1">mdi-drag</v-icon>
        日程未設定 · {{ unscheduled.length }} 件
        <span class="unscheduled-hint">
          — 日付へドラッグして予定開始日を設定
        </span>
      </div>
      <div class="unscheduled-list">
        <button
          v-for="t in unscheduled"
          :key="t.taskId"
          type="button"
          class="unscheduled-item"
          :class="{ 'is-source': draggingTaskId === t.taskId }"
          draggable="true"
          :title="'日付へドラッグ: ' + t.title"
          @dragstart="onUnscheduledDragStart($event, t)"
          @dragend="onUnscheduledDragEnd"
          @click="openTask(t)"
        >
          <v-icon size="14" class="drag-grip" aria-hidden="true">
            mdi-drag-vertical
          </v-icon>
          <span
            class="status-dot"
            :class="`dot-${STATUS_COLORS[t.status]}`"
          />
          <span v-if="t.wbsCode" class="ui-wbs">{{ t.wbsCode }}</span>
          <span class="ui-title">{{ t.title }}</span>
          <span v-if="t.estimatedEffortDays != null" class="ui-effort">
            {{ t.estimatedEffortDays }}人日
          </span>
        </button>
      </div>
    </div>

    <div v-if="!tasks.length" class="tl-empty">
      タスクがありません
    </div>

    <div
      v-else
      ref="scrollerRef"
      class="tl-scroll"
      :class="{ 'drop-active': isDragMode, 'is-drag-mode': isDragMode }"
    >
      <!-- 固定ヘッダー -->
      <div class="tl-header">
        <div class="tl-corner">
          <span class="corner-title">
            {{ isDragMode ? '日付' : 'タスク / WBS' }}
          </span>
          <span class="corner-sub">
            <template v-if="isDragMode">予定開始日を選択</template>
            <template v-else
              >{{ rows.length }} 行 · 幅 {{ Math.round(labelWidth) }}px</template
            >
          </span>
          <div
            class="label-resize-handle"
            title="ドラッグして列幅を変更"
            @pointerdown="onLabelResizePointerDown"
          />
        </div>
        <div class="tl-cal-head" :style="{ width: `${chartWidth}px` }">
          <div class="tl-months">
            <div
              v-for="(m, mi) in monthSpans"
              :key="mi"
              class="tl-month"
              :style="{
                width: `${m.days * dayWidth}px`,
                minWidth: `${m.days * dayWidth}px`,
              }"
            >
              <span class="month-text">{{ m.label }}</span>
            </div>
          </div>
          <div class="tl-days">
            <div
              v-for="(d, di) in days"
              :key="di"
              :class="[
                dayHeaderClass(d, di),
                {
                  'drop-target': hoverDayIndex === di && isDragMode,
                  'is-rest-day': isRestDayAt(d),
                },
              ]"
              :style="{ width: `${dayWidth}px`, minWidth: `${dayWidth}px` }"
              :title="
                (isRestDayAt(d) ? '【休日】' : '【稼働】') +
                d.toLocaleDateString('ja-JP', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }) +
                ' — クリックで休日/稼働を切替'
              "
              @click="toggleRestDay(d, $event)"
              @dragover="onDayDragOver($event, di)"
              @dragleave="onDayDragLeave(di)"
              @drop="onDropDay($event, di)"
            >
              <span class="d-num">{{ d.getDate() }}</span>
              <span class="d-wd">{{ WEEKDAY_LABELS[d.getDay()] }}</span>
              <span v-if="isRestDayAt(d)" class="d-rest-mark">休</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 配置用カレンダー（DOM 常時・CSS で表示切替） -->
      <div
        class="tl-place-row"
        :class="{ 'is-drag-mode': isDragMode, 'is-idle-hidden': !isDragMode }"
      >
        <div class="tl-place-label">
          <v-icon size="18" class="mr-1" color="primary">
            mdi-calendar-plus
          </v-icon>
          予定開始日を設定
        </div>
        <div
          class="tl-place-track"
          :style="{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }"
          @dragover="onTrackDragOver"
          @dragleave="onTrackDragLeave"
          @drop="onDropTrack"
        >
          <div
            v-for="(d, di) in days"
            :key="'p' + di"
            class="place-day"
            :class="[
              dayHeaderClass(d, di),
              { 'is-hover': hoverDayIndex === di && isDragMode },
            ]"
            :style="{ width: `${dayWidth}px`, minWidth: `${dayWidth}px` }"
            @dragover="onDayDragOver($event, di)"
            @dragleave="onDayDragLeave(di)"
            @drop="onDropDay($event, di)"
          >
            <span class="place-day-num">{{ d.getDate() }}</span>
          </div>
        </div>
      </div>

      <!-- 本体行 -->
      <div class="tl-task-body">
        <div v-if="!rows.length" class="tl-body-empty">
          表示するタスクがありません
        </div>

        <div
          v-for="row in rows"
          :key="row.task.taskId"
          class="tl-row"
          :class="{ 'is-parent-row': row.isParent }"
          @click="openTask(row.task)"
        >
          <div
            class="tl-label"
            :title="`${row.task.wbsCode ? row.task.wbsCode + ' ' : ''}${row.task.title}`"
            :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
          >
            <div class="label-main">
              <button
                v-if="row.isParent"
                type="button"
                class="expand-btn"
                :aria-expanded="expandedIds.has(row.task.taskId)"
                :title="expandedIds.has(row.task.taskId) ? '折りたたむ' : '展開'"
                @click="toggleExpand(row.task.taskId, $event)"
              >
                <v-icon size="16">
                  {{
                    expandedIds.has(row.task.taskId)
                      ? 'mdi-chevron-down'
                      : 'mdi-chevron-right'
                  }}
                </v-icon>
              </button>
              <span v-else class="expand-spacer" />
              <span v-if="row.task.wbsCode" class="wbs-code">{{
                row.task.wbsCode
              }}</span>
              <span class="label-title">{{ row.task.title }}</span>
            </div>
            <div class="label-meta">
              <span
                class="status-dot"
                :class="`dot-${STATUS_COLORS[row.task.status]}`"
              />
              <template
                v-for="(seg, si) in labelMetaSegments(row)"
                :key="si"
              >
                <span v-if="si > 0" class="meta-sep" aria-hidden="true">｜</span>
                <span
                  class="meta-seg"
                  :class="{ 'is-status': si === 0 }"
                >{{ seg }}</span>
              </template>
            </div>
            <div
              class="label-resize-handle"
              title="ドラッグして列幅を変更"
              @pointerdown="onLabelResizePointerDown"
            />
          </div>

          <div
            class="tl-track"
            :class="{ 'is-both-mode': dateMode === 'both' }"
            :style="{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }"
            @dragover="onTrackDragOver"
            @dragleave="onTrackDragLeave"
            @drop="onDropTrack"
          >
            <!-- カレンダー格子: 各日セル + 破線境界 + 今日は青背景 -->
            <div
              v-for="(d, di) in days"
              :key="'dc' + di"
              class="day-cell"
              :class="[
                dayHeaderClass(d, di),
                {
                  'is-today-col': todayIndex === di,
                  'is-weekend-col': weekendIndices.has(di),
                  'is-rest-col': isRestDayAt(d),
                },
              ]"
              :style="{ left: `${di * dayWidth}px`, width: `${dayWidth}px` }"
            />

            <!-- 進捗ビュー: 予定の位置・長さ + 内部塗り=進捗%（紫系） -->
            <div
              v-if="showProgress && row.planned.hasBar"
              :class="[
                progressBarClass(row),
                {
                  'is-editable': !row.isParent,
                  'is-dragging-bar': dragPreview?.taskId === row.task.taskId,
                },
              ]"
              :style="plannedBarStyle(row)"
              :title="
                row.isParent
                  ? `${row.task.title}\n${row.planned.detailLabel}\n進捗 ${row.progress}%\n集計（編集不可）`
                  : `${row.task.title}\n${row.planned.detailLabel}\n進捗 ${row.progress}%${row.isDelayed ? '\n⚠ 遅延' : ''}\nドラッグで開始日を移動`
              "
              @pointerdown="onPlannedBarPointerDown($event, row)"
            >
              <div
                class="bar-progress"
                :style="{ width: `${Math.min(100, Math.max(0, row.progress))}%` }"
              />
              <span
                v-if="
                  (dragPreview?.taskId === row.task.taskId
                    ? dragPreview.widthPx
                    : row.planned.widthPx) >= 20
                "
                class="bar-text"
              >
                {{ row.progress }}%
              </span>
            </div>

            <!-- 予定ビュー / 両方上段: 青系・層で濃淡 -->
            <div
              v-if="showPlanned && row.planned.hasBar"
              :class="[
                plannedBarClass(row),
                {
                  'is-editable': !row.isParent,
                  'is-dragging-bar': dragPreview?.taskId === row.task.taskId,
                  'is-dual': dateMode === 'both',
                },
              ]"
              :style="plannedBarStyle(row)"
              :title="
                row.isParent
                  ? `${row.task.title}\n予定 ${row.planned.detailLabel}\n集計（編集不可）`
                  : `${row.task.title}\n予定 ${row.planned.detailLabel}${row.isDelayed ? '\n⚠ 遅延' : ''}\nドラッグで開始日を移動`
              "
              @pointerdown="onPlannedBarPointerDown($event, row)"
            >
              <span
                v-if="
                  plannedEffortText(row) &&
                  (dragPreview?.taskId === row.task.taskId
                    ? dragPreview.widthPx
                    : row.planned.widthPx) >= 20
                "
                class="bar-text"
              >
                {{ plannedEffortText(row) }}
              </span>
            </div>

            <!-- 実績ビュー / 両方下段: 緑系・層で濃淡 -->
            <div
              v-if="showActual && row.actual.hasBar"
              :class="[
                actualBarClass(row),
                { 'is-dual': dateMode === 'both' },
              ]"
              :style="actualBarStyle(row)"
              :title="`${row.task.title}\n実績 ${row.actual.detailLabel}${row.isDelayed ? '\n⚠ 遅延' : ''}`"
            >
              <span
                v-if="row.actual.effortText && row.actual.widthPx >= 20"
                class="bar-text"
              >
                {{ row.actual.effortText }}
              </span>
            </div>

            <!-- 今日: 太めの縦線 -->
            <div
              v-if="todayOffsetPx != null"
              class="today-line"
              :style="{ left: `${todayOffsetPx}px` }"
              title="今日"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 保留（開始日なし） -->
    <div v-if="heldWithoutSchedule.length" class="tl-held">
      <div class="held-title">
        <v-icon size="18" class="mr-1" color="error">mdi-pause-circle-outline</v-icon>
        保留（予定開始日なし）· {{ heldWithoutSchedule.length }} 件
        <span class="held-hint">— ガントには表示されません（クリックで詳細）</span>
      </div>
      <div class="held-list">
        <button
          v-for="t in heldWithoutSchedule"
          :key="t.taskId"
          type="button"
          class="held-item"
          @click="openTask(t)"
        >
          <span class="status-dot dot-error" />
          <span v-if="t.wbsCode" class="ui-wbs">{{ t.wbsCode }}</span>
          <span class="ui-title">{{ t.title }}</span>
          <span v-if="t.estimatedEffortDays != null" class="ui-effort">
            {{ t.estimatedEffortDays }}人日
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tl {
  --label-w: 280px;
  --day-w: 44px;
  --row-h: 52px;
  --header-h: 56px;
  --border: rgba(var(--v-border-color), var(--v-border-opacity));
  --surface: rgb(var(--v-theme-surface));
  --muted: rgba(var(--v-theme-on-surface), 0.55);
}

/* ── Toolbar ── */
.tl-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.tl-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.tl-stat-text {
  font-size: 0.8rem;
  color: var(--muted);
}
.tl-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}


/* ── Legend ── */
.tl-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  font-size: 0.72rem;
  color: var(--muted);
  margin-bottom: 12px;
}
.tl-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg-swatch {
  display: inline-block;
  width: 16px;
  height: 8px;
  border-radius: 3px;
}
.lg-progress {
  background: linear-gradient(90deg, #ec407a 55%, #fce4ec 55%);
  box-sizing: border-box;
}
.lg-planned-shell {
  background: #1565c0;
  box-sizing: border-box;
}
.lg-actual {
  background: #2e7d32;
}
.lg-delayed {
  background: rgba(229, 57, 53, 0.25);
  border: 1.5px solid #e53935;
  box-sizing: border-box;
}
.lg-line {
  display: inline-block;
  width: 2px;
  height: 12px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
}
.lg-today-line {
  width: 3px;
  background: #e53935;
}
.lg-note {
  opacity: 0.75;
}
.toolbar-toggle {
  flex-shrink: 0;
}
.toolbar-toggle :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0.01em;
}
/* 選択中: 青背景・白文字で統一 */
.toolbar-toggle :deep(.v-btn--active) {
  color: #fff !important;
}
.toolbar-solo-btn {
  text-transform: none;
  letter-spacing: 0.01em;
  flex-shrink: 0;
}
/* ズーム: 小さめ・色変化なし */
.zoom-group {
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 0 2px;
  height: 28px;
}
.zoom-icon-btn {
  color: rgba(var(--v-theme-on-surface), 0.65) !important;
}
.zoom-label {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  min-width: 2.4rem;
  text-align: center;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.tl-empty {
  text-align: center;
  padding: 48px 16px;
  color: var(--muted);
  font-size: 0.9rem;
}

/* ── Scroll container ── */
.tl-scroll {
  overflow: auto;
  max-height: calc(100vh - 320px);
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overscroll-behavior: contain;
}
.tl-scroll.drop-active {
  outline: 2px solid rgba(var(--v-theme-primary), 0.45);
  outline-offset: 1px;
}
.tl-scroll.is-drag-mode {
  min-height: 160px;
}

.tl-drag-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.35);
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.85);
}

.day-h.drop-target {
  background: rgba(var(--v-theme-primary), 0.22) !important;
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}

/* 配置用カレンダー */
.tl-place-row {
  display: flex;
  min-width: fit-content;
  min-height: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  border: none;
  background: transparent;
}
.tl-place-row.is-idle-hidden {
  min-height: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.tl-scroll.is-drag-mode .tl-place-row,
.tl-place-row.is-drag-mode {
  min-height: 96px;
  height: auto;
  overflow: visible;
  opacity: 1;
  pointer-events: auto;
  background: rgba(var(--v-theme-primary), 0.08);
  border-bottom: 2px solid rgba(var(--v-theme-primary), 0.4);
}
.tl-place-label {
  position: sticky;
  left: 0;
  z-index: 10;
  flex: 0 0 var(--label-w);
  width: var(--label-w);
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-right: 1px solid var(--border);
  box-sizing: border-box;
}
.tl-place-track {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  min-height: inherit;
  align-items: stretch;
  z-index: 5;
}
.place-day {
  box-sizing: border-box;
  flex-shrink: 0;
  border-right: 1px solid rgba(var(--v-border-color), 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  position: relative;
  z-index: 2;
  cursor: copy;
}
.place-day.is-hover {
  background: rgba(var(--v-theme-primary), 0.28) !important;
  box-shadow: inset 0 0 0 2px rgb(var(--v-theme-primary));
}
.place-day-num {
  font-size: 0.9rem;
  font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.75);
  pointer-events: none;
}
.place-day.is-hover .place-day-num {
  color: rgb(var(--v-theme-primary));
}

.tl-task-body {
  display: block;
}
.tl-scroll.is-drag-mode .tl-task-body {
  display: none;
}
.tl-body-empty--soft {
  opacity: 0.85;
  font-size: 0.82rem;
}

/* ── Header ── */
.tl-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  height: var(--header-h);
  min-width: fit-content;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.tl-corner {
  position: sticky;
  left: 0;
  z-index: 25;
  flex: 0 0 var(--label-w);
  width: var(--label-w);
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 14px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-sizing: border-box;
  overflow: visible;
}

/* 左列幅リサイズハンドル */
.label-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 30;
  touch-action: none;
}
.label-resize-handle:hover,
.label-resize-handle:active {
  background: rgba(var(--v-theme-primary), 0.25);
}
.tl-label .label-resize-handle {
  height: 100%;
}
.corner-title {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.corner-sub {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
}

.tl-cal-head {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tl-months {
  display: flex;
  height: 22px;
  border-bottom: 1px solid var(--border);
  background: rgba(var(--v-theme-primary), 0.05);
}
.tl-month {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.month-text {
  font-size: 0.7rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.7);
  white-space: nowrap;
  padding: 0 4px;
}

.tl-days {
  display: flex;
  flex: 1;
  min-height: 0;
}
.day-h {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-right: 1px dashed rgba(var(--v-theme-on-surface), 0.28);
  line-height: 1.05;
  user-select: none;
  cursor: pointer;
  position: relative;
}
.day-h.is-rest-day {
  background: repeating-linear-gradient(
    -45deg,
    rgba(var(--v-theme-on-surface), 0.06),
    rgba(var(--v-theme-on-surface), 0.06) 3px,
    rgba(var(--v-theme-on-surface), 0.02) 3px,
    rgba(var(--v-theme-on-surface), 0.02) 6px
  );
}
.day-h.is-rest-day .d-num,
.day-h.is-rest-day .d-wd {
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.d-rest-mark {
  position: absolute;
  bottom: 1px;
  right: 2px;
  font-size: 0.5rem;
  font-weight: 800;
  color: rgba(var(--v-theme-on-surface), 0.4);
  line-height: 1;
}
.d-num {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.d-wd {
  font-size: 0.6rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-weight: 600;
}
.day-h.is-weekend {
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.day-h.is-sun .d-wd,
.day-h.is-sun .d-num {
  color: #e57373;
}
.day-h.is-sat .d-wd,
.day-h.is-sat .d-num {
  color: #64b5f6;
}
.day-h.is-today {
  background: rgba(var(--v-theme-primary), 0.18);
}
.day-h.is-today .d-num {
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
}

.today-mark-head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  z-index: 2;
  pointer-events: none;
  border-left: 2px solid rgb(var(--v-theme-primary));
  transform: translateX(-1px);
}
.today-badge {
  position: absolute;
  top: 2px;
  left: 4px;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #fff;
  background: rgb(var(--v-theme-primary));
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 1.3;
}

/* ── Rows ── */
.tl-row {
  display: flex;
  min-width: fit-content;
  height: var(--row-h);
  /* 行間は細い線のみ（バーはセルを上下に埋める） */
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  cursor: pointer;
  transition: background 0.12s ease;
  overflow: hidden;
}
.tl-row .tl-track {
  align-self: stretch;
  min-height: 100%;
}
.tl-row:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.tl-row:hover .tl-label {
  background: rgba(var(--v-theme-primary), 0.04);
}
.tl-row.is-parent-row .label-title {
  font-weight: 700;
}

.tl-label {
  position: sticky;
  left: 0;
  z-index: 10;
  flex: 0 0 var(--label-w);
  width: var(--label-w);
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  padding: 6px 12px 6px 8px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-sizing: border-box;
  overflow: visible;
}
.tl-label .label-title {
  overflow: hidden;
  text-overflow: ellipsis;
}
.label-main {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.expand-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
}
.expand-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.expand-spacer {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
}
.wbs-code {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-primary), 0.9);
  margin-right: 4px;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.label-title {
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(var(--v-theme-on-surface), 0.92);
  min-width: 0;
}
.label-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px 0;
  min-width: 0;
  font-size: 0.68rem;
  color: var(--muted);
  padding-left: 22px;
  line-height: 1.3;
}
.meta-sep {
  margin: 0 4px;
  opacity: 0.4;
  font-weight: 400;
  user-select: none;
}
.meta-seg {
  white-space: nowrap;
}
.meta-seg.is-status {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.72);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #90a4ae;
}
.dot-grey {
  background: #90a4ae;
}
.dot-primary {
  background: #42a5f5;
}
.dot-warning {
  background: #ffb74d;
}
.dot-success {
  background: #66bb6a;
}
.dot-error {
  background: #ef5350;
}
.dot-info {
  background: #29b6f6;
}
.status-text {
  flex-shrink: 0;
}
.effort {
  margin-left: 2px;
  padding-left: 6px;
  border-left: 1px solid var(--border);
  white-space: nowrap;
}

.tl-track {
  position: relative;
  flex: 0 0 auto;
  height: 100%;
  /* 格子は .day-cell で描画 */
  background: transparent;
}

/* 1 日 = 1 セル（破線境界のカレンダー表） */
.day-cell {
  position: absolute;
  top: 0;
  bottom: 0;
  box-sizing: border-box;
  border-right: 1px dashed rgba(var(--v-theme-on-surface), 0.28);
  pointer-events: none;
  z-index: 0;
  background: transparent;
}
.day-cell.is-weekend-col {
  background: rgba(var(--v-theme-on-surface), 0.035);
}
.day-cell.is-rest-col {
  background: repeating-linear-gradient(
    -45deg,
    rgba(var(--v-theme-on-surface), 0.07),
    rgba(var(--v-theme-on-surface), 0.07) 3px,
    rgba(var(--v-theme-on-surface), 0.02) 3px,
    rgba(var(--v-theme-on-surface), 0.02) 6px
  );
}
/* 今日: 列全体を薄い青（赤線 today-line と併用） */
.day-cell.is-today-col {
  background: rgba(var(--v-theme-primary), 0.14);
  border-right-color: rgba(var(--v-theme-primary), 0.35);
}
.day-cell.is-today-col.is-rest-col {
  background: linear-gradient(
      rgba(var(--v-theme-primary), 0.12),
      rgba(var(--v-theme-primary), 0.12)
    ),
    repeating-linear-gradient(
      -45deg,
      rgba(var(--v-theme-on-surface), 0.06),
      rgba(var(--v-theme-on-surface), 0.06) 3px,
      transparent 3px,
      transparent 6px
    );
}

/* ── Bars ──
 * 予定: 浅底 + 破線枠 + 内部塗り=進捗%
 * 実績: 実心（状態色）
 * 親: 空心サマリー + 進捗塗り
 * 遅延: 赤枠
 * 最小幅 10px
 */
.bar {
  position: absolute;
  top: 0;
  bottom: 0;
  height: auto;
  transform: none;
  border-radius: 0;
  overflow: hidden;
  z-index: 2;
  display: flex;
  align-items: center;
  box-shadow: none;
  box-sizing: border-box;
  touch-action: none;
  margin: 0;
}
/* 両方: 上=予定 / 下=実績（隙間なし） */
.bar.is-dual.bar-planned {
  top: 0;
  bottom: 50%;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.bar.is-dual.bar-actual {
  top: 50%;
  bottom: 0;
}

/*
 * 色は status 非依存
 * - 進捗: 紫（浅=未完了シェル / 濃=進捗塗り）層で濃淡
 * - 予定: 青系 depth-0 濃 → depth-2 浅
 * - 実績: 緑系 depth-0 濃 → depth-2 浅
 */
/* ── 進捗ビュー（ピンク系・浅め） ── */
.bar-progress-view {
  background: #fce4ec; /* 未完了（ごく浅） */
  border: none;
  border-right: 1px solid rgba(236, 64, 122, 0.28);
}
.bar-progress-view .bar-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: #f06292; /* 完了分（中ピンク） */
  pointer-events: none;
  z-index: 0;
}
/* 主タスク: やや濃い */
.bar-progress-view.depth-0 {
  background: #f8bbd0;
}
.bar-progress-view.depth-0 .bar-progress {
  background: #ec407a;
}
/* 子 */
.bar-progress-view.depth-1 {
  background: #fce4ec;
}
.bar-progress-view.depth-1 .bar-progress {
  background: #f48fb1;
}
/* 孫: 最も浅く */
.bar-progress-view.depth-2 {
  background: #fff0f5;
}
.bar-progress-view.depth-2 .bar-progress {
  background: #f8bbd0;
}
.bar-progress-view .bar-text {
  color: #ad1457;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.95);
  font-weight: 800;
}

/* ── 予定（青） ── */
.bar-planned {
  border: none;
  border-right: 1px solid rgba(21, 101, 192, 0.35);
}
.bar-planned.depth-0 {
  background: #1565c0;
}
.bar-planned.depth-1 {
  background: #42a5f5;
}
.bar-planned.depth-2 {
  background: #90caf9;
}
.bar-planned .bar-text {
  color: #fff;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
}
.bar-planned.depth-2 .bar-text {
  color: #0d47a1;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.85);
}

/* ── 実績（緑） ── */
.bar-actual {
  border: none;
  border-right: 1px solid rgba(27, 94, 32, 0.35);
  pointer-events: none;
  z-index: 2;
}
.bar-actual.depth-0 {
  background: #2e7d32;
}
.bar-actual.depth-1 {
  background: #66bb6a;
}
.bar-actual.depth-2 {
  background: #a5d6a7;
}
.bar-actual .bar-text {
  color: #fff;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.25);
}
.bar-actual.depth-2 .bar-text {
  color: #1b5e20;
  text-shadow: 0 0 2px rgba(255, 255, 255, 0.85);
}

/* 親サマリーはやや枠で強調（色相は同じ系列） */
.bar-summary {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}

/* 遅延 */
.bar.is-delayed {
  box-shadow: inset 0 0 0 2px #e53935;
}

.bar.is-editable {
  cursor: grab;
}
.bar.is-editable:active,
.bar.is-dragging-bar {
  cursor: grabbing;
  outline: 2px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: -2px;
  z-index: 4;
}
.bar-parent {
  cursor: pointer;
}

/* バー内テキスト */
.bar-text {
  position: relative;
  z-index: 1;
  padding: 0 4px;
  width: 100%;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 3px solid #e53935;
  transform: translateX(-1.5px);
  z-index: 5;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(229, 57, 53, 0.25);
}

.bar.is-grey {
  background: linear-gradient(180deg, #a0b0bb, #78909c);
}
.bar.is-primary {
  background: linear-gradient(180deg, #64b5f6, #1e88e5);
}
.bar.is-warning {
  background: linear-gradient(180deg, #ffcc80, #fb8c00);
}
.bar.is-success {
  background: linear-gradient(180deg, #81c784, #43a047);
}
.bar.is-error {
  background: linear-gradient(180deg, #ef9a9a, #e53935);
}
.bar.is-info {
  background: linear-gradient(180deg, #4dd0e1, #00acc1);
}

.due-flag {
  position: absolute;
  top: 2px;
  z-index: 3;
  transform: translateX(-50%);
  pointer-events: none;
  line-height: 1;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.15));
}

.today-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px dashed rgba(var(--v-theme-primary), 0.7);
  transform: translateX(-1px);
  z-index: 1;
  pointer-events: none;
}

.tl-body-empty {
  padding: 36px 16px;
  text-align: center;
  color: var(--muted);
  font-size: 0.85rem;
  margin-left: var(--label-w);
}

/* ── Unscheduled ── */
.tl-unscheduled {
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px dashed rgba(var(--v-theme-warning), 0.55);
  border-radius: 12px;
  background: rgba(var(--v-theme-warning), 0.06);
  transition: box-shadow 0.15s, border-color 0.15s;
}
.tl-unscheduled.is-dragging {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.2);
}
.unscheduled-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.unscheduled-hint {
  font-weight: 500;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.unscheduled-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.unscheduled-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 6px 12px 6px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: grab;
  font: inherit;
  color: inherit;
  transition: border-color 0.12s, background 0.12s, opacity 0.12s, transform 0.12s;
  user-select: none;
}
.unscheduled-item:active {
  cursor: grabbing;
}
.unscheduled-item:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.unscheduled-item.is-source {
  opacity: 0.45;
  transform: scale(0.97);
}
.drag-grip {
  color: rgba(var(--v-theme-on-surface), 0.4);
  flex-shrink: 0;
}
.ui-wbs {
  font-size: 0.7rem;
  font-weight: 700;
  color: rgba(var(--v-theme-primary), 0.85);
  flex-shrink: 0;
}
.ui-title {
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.ui-effort {
  font-size: 0.7rem;
  color: var(--muted);
  flex-shrink: 0;
}

/* ── Held ── */
.tl-held {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-theme-error), 0.25);
  border-radius: 12px;
  background: rgba(var(--v-theme-error), 0.04);
}
.held-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  font-size: 0.85rem;
  font-weight: 700;
  margin-bottom: 8px;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.held-hint {
  font-weight: 500;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.held-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.held-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  color: inherit;
  transition: border-color 0.12s, background 0.12s;
}
.held-item:hover {
  border-color: rgb(var(--v-theme-error));
  background: rgba(var(--v-theme-error), 0.06);
}
</style>
