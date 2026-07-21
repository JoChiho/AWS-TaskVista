<script setup lang="ts">
/**
 * プロジェクトタスクのガント風カレンダー（タイムライン）
 * - CSS sticky 行レイアウトでヘッダー/左列の重なりを解消
 * - 自分のタスク / 全体の切り替えは親から渡す tasks で制御
 */
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import type { Task } from '@/types/task'
import { STATUS_COLORS, normalizeCompletion } from '@/types/task'
import {
  resolveTaskSchedule,
  computeTimelineRange,
  addDays,
  diffCalendarDays,
  formatDateOnly,
  parseDateOnly,
  startOfLocalDay,
  isWeekend,
  WEEKDAY_LABELS,
  type TaskSchedule,
} from '@/utils/taskSchedule'
import { resolveAssigneeLabels } from '@/utils/displayName'

const DND_MIME = 'application/x-taskvista-task-id'

const props = defineProps<{
  tasks: Task[]
  /** 開始日を保存中（ドロップ後の二重操作防止） */
  savingStartDate?: boolean
}>()

const emit = defineEmits<{
  open: [task: Task]
  /** 未設定タスクをカレンダーにドロップしたときの開始日設定 */
  'set-start-date': [payload: { taskId: string; startDate: string; task: Task }]
}>()

/** 1 日あたりの幅（px）— 重なりにくい既定値 */
const dayWidth = ref(44)
const LABEL_WIDTH = 248
const ROW_HEIGHT = 52
const HEADER_H = 56

interface TimelineRow {
  task: Task
  schedule: TaskSchedule
  leftPx: number
  widthPx: number
  progress: number
  assignees: string
  dueLeftPx: number | null
  rangeLabel: string
}

const scheduled = computed(() => {
  return props.tasks
    .map((task) => ({ task, schedule: resolveTaskSchedule(task) }))
    .filter((x) => x.schedule.hasBar)
    .sort((a, b) => {
      const as = a.schedule.start!.getTime()
      const bs = b.schedule.start!.getTime()
      if (as !== bs) return as - bs
      return a.task.title.localeCompare(b.task.title, 'ja')
    })
})

/**
 * 日程未設定バー（ドラッグで開始日を付ける対象）:
 * 開始日なし かつ ステータスが「保留」以外。
 * （ステータスを変えたあと開始日を忘れないよう、未着手以外も対象にする）
 */
const unscheduled = computed(() =>
  props.tasks.filter(
    (t) => t.status !== '保留' && !resolveTaskSchedule(t).hasBar,
  ),
)

/**
 * 開始日なしの保留（ドラッグ対象外）。
 * タイムライン上のバーには出ないが、下方リストで確認・詳細を開ける。
 */
const heldWithoutSchedule = computed(() =>
  props.tasks.filter(
    (t) => t.status === '保留' && !resolveTaskSchedule(t).hasBar,
  ),
)

const range = computed(() =>
  computeTimelineRange(
    scheduled.value.map((s) => s.task),
    3,
  ),
)

const days = computed(() => {
  const list: Date[] = []
  let d = range.value.rangeStart
  for (let i = 0; i < range.value.totalDays; i++) {
    list.push(d)
    d = addDays(d, 1)
  }
  return list
})

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

const chartWidth = computed(() => range.value.totalDays * dayWidth.value)
const today = computed(() => startOfLocalDay(new Date()))

const todayIndex = computed(() => {
  const idx = diffCalendarDays(today.value, range.value.rangeStart)
  if (idx < 0 || idx >= range.value.totalDays) return null
  return idx
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

const rows = computed<TimelineRow[]>(() => {
  return scheduled.value.map(({ task, schedule }) => {
    const startIdx = diffCalendarDays(schedule.start!, range.value.rangeStart)
    const spanDays = Math.max(
      1,
      diffCalendarDays(schedule.endExclusive!, schedule.start!),
    )
    // 範囲外クリップ
    const visibleStart = Math.max(0, startIdx)
    const visibleEnd = Math.min(range.value.totalDays, startIdx + spanDays)
    const visibleDays = Math.max(0.5, visibleEnd - visibleStart)
    const widthPx = visibleDays * dayWidth.value

    const due = parseDateOnly(task.dueDate)
    let dueLeftPx: number | null = null
    if (due) {
      const di = diffCalendarDays(due, range.value.rangeStart)
      if (di >= 0 && di < range.value.totalDays) {
        dueLeftPx = (di + 0.5) * dayWidth.value
      }
    }

    const startStr = schedule.start
      ? schedule.start.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
      : ''
    const endStr = schedule.endInclusive
      ? schedule.endInclusive.toLocaleDateString('ja-JP', {
          month: 'numeric',
          day: 'numeric',
        })
      : ''

    return {
      task,
      schedule,
      leftPx: visibleStart * dayWidth.value,
      widthPx: Math.max(widthPx, 10),
      progress: normalizeCompletion(task.completionPercent),
      assignees: resolveAssigneeLabels(task).join('、') || '未割り当て',
      dueLeftPx,
      rangeLabel: startStr && endStr ? `${startStr}〜${endStr}` : startStr,
    }
  })
})

function dayHeaderClass(d: Date, index: number): string {
  const classes: string[] = ['day-h']
  if (isWeekend(d)) classes.push('is-weekend')
  if (todayIndex.value === index) classes.push('is-today')
  if (d.getDay() === 0) classes.push('is-sun')
  if (d.getDay() === 6) classes.push('is-sat')
  return classes.join(' ')
}

function barClass(task: Task): string {
  const c = STATUS_COLORS[task.status] || 'primary'
  return `bar is-${c}`
}

function zoomIn() {
  dayWidth.value = Math.min(64, dayWidth.value + 4)
}
function zoomOut() {
  dayWidth.value = Math.max(28, dayWidth.value - 4)
}

const scrollerRef = ref<HTMLElement | null>(null)

function scrollToToday() {
  const el = scrollerRef.value
  if (!el || todayOffsetPx.value == null) return
  const target = todayOffsetPx.value - (el.clientWidth - LABEL_WIDTH) / 2
  el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
}

watch(
  () => [rows.value.length, dayWidth.value, props.tasks.length] as const,
  async () => {
    await nextTick()
    // 初回のみ今日へ（スムーズなし）
    const el = scrollerRef.value
    if (!el || todayOffsetPx.value == null) return
    if (el.scrollLeft === 0) {
      const target = todayOffsetPx.value - (el.clientWidth - LABEL_WIDTH) / 2
      el.scrollLeft = Math.max(0, target)
    }
  },
  { flush: 'post' },
)

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

// ── ドラッグ＆ドロップで開始日を設定 ─────────────────
const draggingTaskId = ref<string | null>(null)
const hoverDayIndex = ref<number | null>(null)
/** ドラッグ直後の click を無視 */
const suppressClick = ref(false)

const draggingTask = computed(() => {
  if (!draggingTaskId.value) return null
  return props.tasks.find((t) => t.taskId === draggingTaskId.value) ?? null
})

/**
 * 重要: dragstart 直後に v-if で大量 DOM を消すと、ブラウザがドラッグをキャンセルする。
 * そのため draggingTaskId の反映を次ティックに遅らせ、表示切替は CSS クラス中心にする。
 */
function onUnscheduledDragStart(e: DragEvent, task: Task) {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(DND_MIME, task.taskId)
  e.dataTransfer.setData('text/plain', task.taskId)
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.dropEffect = 'copy'
  // 同期で ID を保持（ドロップ時 getData が空のブラウザ向け）
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

/** ドラッグ中は他タスク行を CSS で隠し、配置用カレンダーだけ見せる */
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
  // 子要素へ移った場合は無視
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
  // 既に開始日があるタスクのドロップは無視（未設定の割当専用）
  if (task.startDate) return

  const startDate = formatDateOnly(day)
  emit('set-start-date', { taskId, startDate, task })
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

const cssVars = computed(() => ({
  '--label-w': `${LABEL_WIDTH}px`,
  '--day-w': `${dayWidth.value}px`,
  '--row-h': `${ROW_HEIGHT}px`,
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
          {{ scheduled.length }} 件表示
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
          （{{ days.length }}日）
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
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-calendar-today"
          @click="scrollToToday"
        >
          今日
        </v-btn>
        <div class="zoom-group">
          <v-btn
            size="small"
            variant="outlined"
            icon="mdi-magnify-minus-outline"
            :disabled="dayWidth <= 28"
            @click="zoomOut"
          />
          <span class="zoom-label">{{ dayWidth }}px</span>
          <v-btn
            size="small"
            variant="outlined"
            icon="mdi-magnify-plus-outline"
            :disabled="dayWidth >= 64"
            @click="zoomIn"
          />
        </div>
      </div>
    </div>

    <!-- 凡例（ドラッグ中は簡潔に） -->
    <div v-if="!isDragMode" class="tl-legend">
      <span><i class="lg-swatch lg-bar" />期間 = 開始日 + 予定工数</span>
      <span><i class="lg-swatch lg-fill" />進捗</span>
      <span><i class="lg-line" />今日</span>
      <span><v-icon size="12" color="error">mdi-flag-variant</v-icon> 締切（参考）</span>
      <span class="lg-note">
        <v-icon size="12">mdi-cursor-move</v-icon>
        未設定タスクを日付へドラッグすると、開始日を設定できます
      </span>
    </div>
    <div v-else class="tl-drag-banner">
      <v-icon size="20" color="primary" class="mr-2">mdi-calendar-cursor</v-icon>
      <span>
        <strong>開始日を設定中</strong>
        — 下の日付を選んでください
        <template v-if="draggingTask && hoverDayIndex != null">
          ：「{{ draggingTask.title }}」→
          <strong>{{ hoverDayLabel(hoverDayIndex) }}</strong>
        </template>
      </span>
    </div>

    <!-- 未スケジュール（カレンダー上にドラッグしやすいよう上部配置） -->
    <div
      v-if="unscheduled.length"
      class="tl-unscheduled"
      :class="{ 'is-dragging': isDragMode }"
    >
      <div class="unscheduled-title">
        <v-icon size="18" class="mr-1">mdi-drag</v-icon>
        日程未設定 · {{ unscheduled.length }} 件
        <span class="unscheduled-hint">
          — 日付へドラッグして開始日を設定
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
      <!-- ===== 固定ヘッダー行（常時マウント） ===== -->
      <div class="tl-header">
        <div class="tl-corner">
          <span class="corner-title">
            {{ isDragMode ? '日付' : 'タスク' }}
          </span>
          <span class="corner-sub">
            <template v-if="isDragMode">開始日を選択</template>
            <template v-else>{{ rows.length }} / {{ tasks.length }}</template>
          </span>
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
                { 'drop-target': hoverDayIndex === di && isDragMode },
              ]"
              :style="{ width: `${dayWidth}px`, minWidth: `${dayWidth}px` }"
              :title="
                d.toLocaleDateString('ja-JP', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })
              "
              @dragover="onDayDragOver($event, di)"
              @dragleave="onDayDragLeave(di)"
              @drop="onDropDay($event, di)"
            >
              <span class="d-num">{{ d.getDate() }}</span>
              <span class="d-wd">{{ WEEKDAY_LABELS[d.getDay()] }}</span>
            </div>
          </div>
          <div
            v-if="todayOffsetPx != null"
            class="today-mark-head"
            :style="{ left: `${todayOffsetPx}px` }"
          >
            <span class="today-badge">今日</span>
          </div>
        </div>
      </div>

      <!--
        配置用カレンダー: 常時 DOM に残すが、非ドラッグ時は完全に畳む。
        （v-if で消すとドラッグがキャンセルされるため CSS で隠す）
        ドラッグ中だけ大きく表示する。
      -->
      <div
        class="tl-place-row"
        :class="{ 'is-drag-mode': isDragMode, 'is-idle-hidden': !isDragMode }"
      >
        <div class="tl-place-label">
          <v-icon size="18" class="mr-1" color="primary">
            mdi-calendar-plus
          </v-icon>
          開始日を設定
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

      <!-- ===== 本体行: 常時マウント、ドラッグ中は CSS で非表示 ===== -->
      <div class="tl-task-body">
        <div
          v-if="!rows.length && unscheduled.length === 0"
          class="tl-body-empty"
        >
          開始日を設定すると、タイムラインが表示されます
        </div>
        <div
          v-else-if="!rows.length && unscheduled.length > 0"
          class="tl-body-empty tl-body-empty--soft"
        >
          タイムラインに表示するタスクはまだありません。上の一覧から日付へドラッグしてください
        </div>

        <div
          v-for="row in rows"
          :key="row.task.taskId"
          class="tl-row"
          @click="openTask(row.task)"
        >
          <div class="tl-label" :title="row.task.title">
            <div class="label-title">{{ row.task.title }}</div>
            <div class="label-meta">
              <span
                class="status-dot"
                :class="`dot-${STATUS_COLORS[row.task.status]}`"
              />
              <span class="status-text">{{ row.task.status }}</span>
              <span v-if="row.task.estimatedEffortDays != null" class="effort">
                {{ row.task.estimatedEffortDays }}人日
              </span>
            </div>
          </div>

          <div
            class="tl-track"
            :style="{ width: `${chartWidth}px`, minWidth: `${chartWidth}px` }"
            @dragover="onTrackDragOver"
            @dragleave="onTrackDragLeave"
            @drop="onDropTrack"
          >
            <div
              v-for="di in weekendIndices"
              :key="'w' + di"
              class="weekend-col"
              :style="{ left: `${di * dayWidth}px`, width: `${dayWidth}px` }"
            />
            <div
              v-if="todayIndex != null"
              class="today-col"
              :style="{ left: `${todayIndex * dayWidth}px`, width: `${dayWidth}px` }"
            />

            <div
              :class="barClass(row.task)"
              :style="{ left: `${row.leftPx}px`, width: `${row.widthPx}px` }"
              :title="`${row.task.title}\n${row.rangeLabel}\n進捗 ${row.progress}%\n${row.assignees}`"
            >
              <div class="bar-progress" :style="{ width: `${row.progress}%` }" />
              <span v-if="row.widthPx >= 48" class="bar-text">
                {{ row.rangeLabel }}
                <template v-if="row.progress > 0"> · {{ row.progress }}%</template>
              </span>
              <span v-else-if="row.widthPx >= 28" class="bar-text">
                {{ row.progress }}%
              </span>
            </div>

            <div
              v-if="row.dueLeftPx != null"
              class="due-flag"
              :style="{ left: `${row.dueLeftPx}px` }"
              title="締切日"
            >
              <v-icon size="13" color="error">mdi-flag-variant</v-icon>
            </div>

            <div
              v-if="todayOffsetPx != null"
              class="today-line"
              :style="{ left: `${todayOffsetPx}px` }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 保留（開始日なし）: ドラッグ対象外、下方針で一覧のみ -->
    <div v-if="heldWithoutSchedule.length" class="tl-held">
      <div class="held-title">
        <v-icon size="18" class="mr-1" color="error">mdi-pause-circle-outline</v-icon>
        保留（開始日なし）· {{ heldWithoutSchedule.length }} 件
        <span class="held-hint">— タイムラインには表示されません（クリックで詳細）</span>
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
  --label-w: 248px;
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
}
.zoom-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.zoom-label {
  font-size: 0.72rem;
  color: var(--muted);
  min-width: 36px;
  text-align: center;
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
.lg-bar {
  background: #5c9ce6;
}
.lg-fill {
  background: linear-gradient(90deg, #66bb6a 55%, #cfd8dc 55%);
}
.lg-line {
  display: inline-block;
  width: 2px;
  height: 12px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
}
.lg-note {
  opacity: 0.75;
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

/* 配置用カレンダー（DOM は常時・非ドラッグ時は完全非表示） */
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
  /* 明示用（!isDragMode と併用） */
  min-height: 0;
  height: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
/* ドラッグ中だけ表示（DOM を消さないのでドラッグは切れない） */
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

/* ドラッグ中はタスク行を CSS で隠す（DOM は残す） */
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

/* ── Header (sticky top) ── */
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
  border-right: 1px solid rgba(var(--v-border-color), 0.35);
  line-height: 1.05;
  user-select: none;
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
  background: rgba(var(--v-theme-primary), 0.14);
}
.day-h.is-today .d-num {
  color: rgb(var(--v-theme-primary));
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
  border-bottom: 1px solid rgba(var(--v-border-color), 0.4);
  cursor: pointer;
  transition: background 0.12s ease;
}
.tl-row:hover {
  background: rgba(var(--v-theme-primary), 0.04);
}
.tl-row:hover .tl-label {
  background: rgba(var(--v-theme-primary), 0.04);
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
  padding: 6px 12px 6px 14px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  box-sizing: border-box;
  overflow: hidden;
}
.label-title {
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(var(--v-theme-on-surface), 0.92);
}
.label-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.7rem;
  color: var(--muted);
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
  /* 日境界の細い線（等間隔グリッド） */
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(var(--day-w) - 1px),
    rgba(var(--v-border-color), 0.28) calc(var(--day-w) - 1px),
    rgba(var(--v-border-color), 0.28) var(--day-w)
  );
  background-size: var(--day-w) 100%;
}

.weekend-col {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(var(--v-theme-on-surface), 0.03);
  pointer-events: none;
  z-index: 0;
}
.today-col {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(var(--v-theme-primary), 0.06);
  pointer-events: none;
  z-index: 0;
}

/* ── Bars ── */
.bar {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 26px;
  border-radius: 7px;
  overflow: hidden;
  z-index: 2;
  display: flex;
  align-items: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-sizing: border-box;
}
.bar-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(255, 255, 255, 0.35);
  pointer-events: none;
}
.bar-text {
  position: relative;
  z-index: 1;
  padding: 0 8px;
  font-size: 0.68rem;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
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

/* ── Unscheduled（上部・ドラッグ元） ── */
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
.drop-hint-banner {
  margin-bottom: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 0.8rem;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
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
.ui-title {
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.ui-effort {
  font-size: 0.72rem;
  color: var(--muted);
  white-space: nowrap;
}

/* ── 保留（開始日なし）下方リスト ── */
.tl-held {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--v-border-color), 0.7);
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
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.held-hint {
  font-weight: 500;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.held-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.held-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
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
