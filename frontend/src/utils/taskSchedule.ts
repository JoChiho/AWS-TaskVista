/**
 * タスクのスケジュール期間を算出する（ガント / カレンダー用）
 *
 * 【予定バー】
 *   - 開始日 + 終了日がある → その暦日セルをすべて塗りつぶす（工数は幅に使わない）
 *   - 終了日がなく工数のみ → 営業日で工数分伸ばし、土日・休日をまたいで暦日を延長
 *
 * 【休日】
 *   - 既定: 土・日
 *   - ユーザーが日付ヘッダをクリックして休日/稼働を上書き可能
 */
import type { Task } from '@/types/task'
import { getPlannedDueDate, getPlannedStartDate } from '@/types/task'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type ScheduleSource =
  | 'start+effort'
  | 'start-only'
  | 'none'

export interface TaskSchedule {
  /** 期間開始（ローカル 0:00）= 予定/実績開始日 */
  start: Date | null
  /** 期間終了（ローカル 0:00・最終日の翌日 = 排他的終端）※レンジ用 */
  endExclusive: Date | null
  /** 表示用の最終日（含む） */
  endInclusive: Date | null
  /** 工数（人日）— ラベル用。バー幅は start〜end の暦日 */
  durationDays: number
  source: ScheduleSource
  hasBar: boolean
  anchorDue?: Date | null
  layoutMode?: 'calendar-span' | 'effort-working'
}

/** 休日判定 */
export type RestDayPredicate = (d: Date) => boolean

/** 既定: 土・日を休日 */
export function isWeekendRestDay(d: Date): boolean {
  const w = d.getDay()
  return w === 0 || w === 6
}

/**
 * カスタム休日/稼働日を加味
 * restDates: 休日にする日, workDates: 稼働にする日（週末上書き）
 */
export function createRestDayPredicate(
  restDates: Set<string> | Iterable<string> = [],
  workDates: Set<string> | Iterable<string> = [],
  base: RestDayPredicate = isWeekendRestDay,
): RestDayPredicate {
  const rest = restDates instanceof Set ? restDates : new Set(restDates)
  const work = workDates instanceof Set ? workDates : new Set(workDates)
  return (d: Date) => {
    const key = formatDateOnly(d)
    if (work.has(key)) return false
    if (rest.has(key)) return true
    return base(d)
  }
}

/**
 * 開始 + 営業日工数 → 最終稼働日（含む）。休日はスキップしカレンダーは延長。
 */
export function endDateFromWorkingEffort(
  start: Date,
  effortDays: number,
  isRest: RestDayPredicate = isWeekendRestDay,
): Date {
  const effort = Math.max(0, Number(effortDays) || 0)
  if (effort <= 0) return startOfLocalDay(start)

  let remaining = effort
  let d = startOfLocalDay(start)
  let lastWork = d
  let guard = 0
  while (remaining > 1e-9 && guard < 3660) {
    guard++
    if (!isRest(d)) {
      if (remaining >= 1 - 1e-9) {
        remaining -= 1
        lastWork = d
        if (remaining <= 1e-9) break
        d = addDays(d, 1)
      } else {
        lastWork = d
        remaining = 0
        break
      }
    } else {
      d = addDays(d, 1)
    }
  }
  return lastWork
}

export function inclusiveCalendarDays(start: Date, endInclusive: Date): number {
  return Math.max(1, diffCalendarDays(endInclusive, start) + 1)
}

/** YYYY-MM-DD をローカル日付として解釈 */
export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    return startOfLocalDay(d)
  }
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const day = Number(m[3])
  const d = new Date(y, mo, day)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getTime())
  next.setDate(next.getDate() + days)
  return startOfLocalDay(next)
}

export function diffCalendarDays(a: Date, b: Date): number {
  const sa = startOfLocalDay(a).getTime()
  const sb = startOfLocalDay(b).getTime()
  return Math.round((sa - sb) / MS_PER_DAY)
}

export function formatDateOnly(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function normalizeEffort(raw: number | null | undefined): number {
  if (raw == null || Number.isNaN(Number(raw))) return 0
  return Math.max(0, Math.round(Number(raw) * 1000) / 1000)
}

function emptySchedule(): TaskSchedule {
  return {
    start: null,
    endExclusive: null,
    endInclusive: null,
    durationDays: 0,
    source: 'none',
    hasBar: false,
    anchorDue: null,
    layoutMode: 'calendar-span',
  }
}

/**
 * 予定バー用:
 * - 開始+終了あり → calendar-span（セルを開始〜終了で埋める）
 * - 終了なし+工数 → effort-working（営業日で延長、休日またぎ）
 */
export function resolveTaskSchedule(
  task: Task,
  isRest: RestDayPredicate = isWeekendRestDay,
): TaskSchedule {
  const start = parseDateOnly(getPlannedStartDate(task))
  if (!start) return emptySchedule()

  const due = parseDateOnly(getPlannedDueDate(task))
  const effort = normalizeEffort(task.estimatedEffortDays)

  if (due && due.getTime() >= start.getTime()) {
    return {
      start,
      endInclusive: due,
      endExclusive: addDays(due, 1),
      durationDays: effort > 0 ? effort : inclusiveCalendarDays(start, due),
      source: 'start+effort',
      hasBar: true,
      anchorDue: due,
      layoutMode: 'calendar-span',
    }
  }

  if (effort > 0) {
    const endInclusive = endDateFromWorkingEffort(start, effort, isRest)
    return {
      start,
      endInclusive,
      endExclusive: addDays(endInclusive, 1),
      durationDays: effort,
      source: 'start+effort',
      hasBar: true,
      anchorDue: endInclusive,
      layoutMode: 'effort-working',
    }
  }

  // 開始のみ
  return {
    start,
    endInclusive: start,
    endExclusive: addDays(start, 1),
    durationDays: 1,
    source: 'start-only',
    hasBar: true,
    anchorDue: start,
    layoutMode: 'calendar-span',
  }
}

function scheduleFromStartDueOrEffort(
  startRaw: string | undefined | null,
  dueRaw: string | undefined | null,
  effortRaw: number | undefined | null,
  isRest: RestDayPredicate = isWeekendRestDay,
): TaskSchedule {
  const start = parseDateOnly(startRaw)
  if (!start) return emptySchedule()

  const due = parseDateOnly(dueRaw)
  const effort = normalizeEffort(effortRaw)

  if (due && due.getTime() >= start.getTime()) {
    return {
      start,
      endInclusive: due,
      endExclusive: addDays(due, 1),
      durationDays: effort > 0 ? effort : inclusiveCalendarDays(start, due),
      source: 'start+effort',
      hasBar: true,
      anchorDue: due,
      layoutMode: 'calendar-span',
    }
  }

  if (effort > 0) {
    const endInclusive = endDateFromWorkingEffort(start, effort, isRest)
    return {
      start,
      endInclusive,
      endExclusive: addDays(endInclusive, 1),
      durationDays: effort,
      source: 'start+effort',
      hasBar: true,
      anchorDue: endInclusive,
      layoutMode: 'effort-working',
    }
  }

  return {
    start,
    endInclusive: start,
    endExclusive: addDays(start, 1),
    durationDays: 1,
    source: 'start-only',
    hasBar: true,
    anchorDue: start,
    layoutMode: 'calendar-span',
  }
}

/** ガント「予定」バー */
export function resolveGanttBarSchedule(
  task: Task,
  isRest: RestDayPredicate = isWeekendRestDay,
): TaskSchedule {
  const isParent = (task.childCount ?? 0) > 0
  if (isParent && task.rollup) {
    return scheduleFromStartDueOrEffort(
      task.rollup.plannedStartDate,
      task.rollup.plannedDueDate,
      task.rollup.estimatedEffortDaysSum,
      isRest,
    )
  }
  return resolveTaskSchedule(task, isRest)
}

/** ガント「実績」バー */
export function resolveActualGanttBarSchedule(
  task: Task,
  isRest: RestDayPredicate = isWeekendRestDay,
): TaskSchedule {
  const isParent = (task.childCount ?? 0) > 0
  if (isParent && task.rollup) {
    return scheduleFromStartDueOrEffort(
      task.rollup.actualStartDate,
      task.rollup.actualDueDate,
      task.rollup.actualEffortDaysSum,
      isRest,
    )
  }
  return scheduleFromStartDueOrEffort(
    task.actualStartDate,
    task.actualDueDate,
    task.actualEffortDays,
    isRest,
  )
}

/** 短タスク最小幅（px）— calendar-span ではセル単位のため通常不要 */
export const GANTT_BAR_MIN_WIDTH_PX = 10

/**
 * ガントバーのピクセル配置
 *
 * - calendar-span: 開始日セル左端 〜 終了日セル右端（全日セル塗りつぶし）
 * - effort-working: 開始〜営業日換算終了をセル単位で塗る（休日をまたいで延長）
 */
export function layoutGanttBarPx(
  schedule: TaskSchedule,
  rangeStart: Date,
  dayWidthPx: number,
  _minWidthPx: number = GANTT_BAR_MIN_WIDTH_PX,
): { leftPx: number; widthPx: number } | null {
  if (!schedule.hasBar || !schedule.start || dayWidthPx <= 0) return null

  const startIdx = diffCalendarDays(schedule.start, rangeStart)
  const endDay =
    schedule.endInclusive ??
    schedule.anchorDue ??
    schedule.start
  const endIdx = diffCalendarDays(endDay, rangeStart)
  const span = Math.max(1, endIdx - startIdx + 1)

  return {
    leftPx: startIdx * dayWidthPx,
    widthPx: span * dayWidthPx,
  }
}

/**
 * ガント表示モード
 * - progress: 進捗（既定）— 予定の位置・長さ + 内部塗り=進捗%
 * - planned: 予定日
 * - actual: 実績日
 * - both: 予定 + 実績（上下）
 */
export type GanttDateMode = 'progress' | 'planned' | 'actual' | 'both'

/** 表示モードに応じたバー幾何を列挙（レンジ算出用） */
export function collectGanttSchedules(
  tasks: Task[],
  mode: GanttDateMode,
  isRest: RestDayPredicate = isWeekendRestDay,
): TaskSchedule[] {
  const out: TaskSchedule[] = []
  for (const t of tasks) {
    // 進捗ビューは予定の位置・長さを使う
    if (mode === 'progress' || mode === 'planned' || mode === 'both') {
      out.push(resolveGanttBarSchedule(t, isRest))
    }
    if (mode === 'actual' || mode === 'both') {
      out.push(resolveActualGanttBarSchedule(t, isRest))
    }
  }
  return out
}

/** バーを 1 日グリッドで動かしたときの新開始日・工数（右端固定用） */
export function shiftScheduleByDays(
  plannedStartDate: string,
  estimatedEffortDays: number | null | undefined,
  deltaDays: number,
): { plannedStartDate: string; estimatedEffortDays: number } {
  const start = parseDateOnly(plannedStartDate) ?? startOfLocalDay(new Date())
  const effort =
    estimatedEffortDays != null && !Number.isNaN(Number(estimatedEffortDays)) && Number(estimatedEffortDays) > 0
      ? Number(estimatedEffortDays)
      : 1
  const nextStart = addDays(start, deltaDays)
  return {
    plannedStartDate: formatDateOnly(nextStart),
    estimatedEffortDays: effort,
  }
}

/**
 * 左縁リサイズ: 右端（開始+工数）を固定して開始日と工数を再計算。
 * 最小工数 minEffort（既定 0.5）
 */
export function resizeScheduleFromLeft(
  plannedStartDate: string,
  estimatedEffortDays: number | null | undefined,
  newStartDate: string,
  minEffort = 0.5,
): { plannedStartDate: string; estimatedEffortDays: number } {
  const oldStart = parseDateOnly(plannedStartDate) ?? startOfLocalDay(new Date())
  const effort =
    estimatedEffortDays != null && !Number.isNaN(Number(estimatedEffortDays)) && Number(estimatedEffortDays) > 0
      ? Number(estimatedEffortDays)
      : 1
  const endExclusive = addDays(oldStart, Math.max(1, Math.ceil(effort - 1e-9)))
  const newStart = parseDateOnly(newStartDate) ?? oldStart
  // 右端の前まで
  let newEffort = diffCalendarDays(endExclusive, newStart)
  if (newEffort < minEffort) newEffort = minEffort
  // 新開始が右端以降なら、右端を 1 日伸ばす代わりに min でクランプ
  if (newStart.getTime() >= endExclusive.getTime()) {
    const clampedStart = addDays(endExclusive, -Math.max(1, Math.ceil(minEffort)))
    return {
      plannedStartDate: formatDateOnly(clampedStart),
      estimatedEffortDays: minEffort,
    }
  }
  return {
    plannedStartDate: formatDateOnly(newStart),
    estimatedEffortDays: Math.round(newEffort * 10) / 10,
  }
}

/** 右縁リサイズ: 開始固定、工数変更 */
export function resizeScheduleFromRight(
  plannedStartDate: string,
  newEndInclusiveDate: string,
  minEffort = 0.5,
): { plannedStartDate: string; estimatedEffortDays: number } {
  const start = parseDateOnly(plannedStartDate) ?? startOfLocalDay(new Date())
  const endInc = parseDateOnly(newEndInclusiveDate) ?? start
  let days = diffCalendarDays(endInc, start) + 1
  if (days < minEffort) days = minEffort
  return {
    plannedStartDate: formatDateOnly(start),
    estimatedEffortDays: Math.round(days * 10) / 10,
  }
}

/** タイムライン全体の日付レンジ（ガントバー群から算出） */
export function computeTimelineRange(
  tasks: Task[],
  paddingDays = 3,
  mode: GanttDateMode = 'planned',
  isRest: RestDayPredicate = isWeekendRestDay,
): { rangeStart: Date; rangeEndExclusive: Date; totalDays: number } {
  const schedules = collectGanttSchedules(tasks, mode, isRest).filter(
    (s) => s.hasBar && s.start && s.endExclusive,
  )
  const today = startOfLocalDay(new Date())

  if (schedules.length === 0) {
    const rangeStart = addDays(today, -7)
    const rangeEndExclusive = addDays(today, 15)
    return {
      rangeStart,
      rangeEndExclusive,
      totalDays: diffCalendarDays(rangeEndExclusive, rangeStart),
    }
  }

  let min = schedules[0]!.start!
  let maxEx = schedules[0]!.endExclusive!
  for (const s of schedules) {
    if (s.start && s.start < min) min = s.start
    if (s.endExclusive && s.endExclusive > maxEx) maxEx = s.endExclusive
  }

  // 予定終了が見切れないよう、予定/進捗モード時は予定終了日もレンジに含める
  if (mode === 'planned' || mode === 'progress' || mode === 'both') {
    for (const t of tasks) {
      const due = parseDateOnly(getPlannedDueDate(t))
      if (!due) continue
      if (due < min) min = due
      if (due >= maxEx) maxEx = addDays(due, 1)
    }
  }
  if (mode === 'actual' || mode === 'both') {
    for (const t of tasks) {
      const due = parseDateOnly(
        (t.childCount ?? 0) > 0 ? t.rollup?.actualDueDate : t.actualDueDate,
      )
      if (!due) continue
      if (due < min) min = due
      if (due >= maxEx) maxEx = addDays(due, 1)
    }
  }

  if (today < min) min = today
  if (today >= maxEx) maxEx = addDays(today, 1)

  const rangeStart = addDays(min, -paddingDays)
  const rangeEndExclusive = addDays(maxEx, paddingDays)
  const totalDays = Math.max(1, diffCalendarDays(rangeEndExclusive, rangeStart))

  return { rangeStart, rangeEndExclusive, totalDays }
}

/** 曜日ラベル（日本語短） */
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

export function isWeekend(d: Date): boolean {
  const w = d.getDay()
  return w === 0 || w === 6
}
