/**
 * タスクのスケジュール期間を算出する（タイムライン / カレンダー用）
 *
 * 【方針】予定開始日がタイムラインの基準。予定終了日からの逆算はしない。
 *
 * バーを描画する条件:
 *   - 予定開始日があること（必須）
 *   - 長さ = 予定工数（人日）。未設定時は 1 日
 *
 * 予定終了日:
 *   - 期間バーの位置・長さには使わない（フラグ表示のみ）
 *   - 予定開始日が無いタスクは「日程未設定」（終了日だけあってもバーを出さない）
 */
import type { Task } from '@/types/task'
import { getPlannedDueDate, getPlannedStartDate } from '@/types/task'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type ScheduleSource =
  | 'start+effort'
  | 'start-only'
  | 'none'

export interface TaskSchedule {
  /** 期間開始（ローカル 0:00）= 予定開始日 */
  start: Date | null
  /** 期間終了（ローカル 0:00・最終日の翌日 = 排他的終端） */
  endExclusive: Date | null
  /** 表示用の最終日（含む） */
  endInclusive: Date | null
  durationDays: number
  source: ScheduleSource
  /** タイムライン上にバーを描けるか（予定開始日あり） */
  hasBar: boolean
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

function buildRange(
  start: Date,
  durationDays: number,
  source: ScheduleSource,
): TaskSchedule {
  const dur = Math.max(durationDays, 0.25)
  // 端数日は ceil してカレンダー上の最終日を決める
  const wholeDays = Math.max(1, Math.ceil(dur - 1e-9))
  const endInclusive = addDays(start, wholeDays - 1)
  const endExclusive = addDays(start, wholeDays)
  return {
    start,
    endExclusive,
    endInclusive,
    durationDays: dur,
    source,
    hasBar: true,
  }
}

/**
 * 予定開始日を基準に期間を決める。
 * ステータス（完了など）や予定終了日はバー位置に影響しない。
 */
export function resolveTaskSchedule(task: Task): TaskSchedule {
  const start = parseDateOnly(getPlannedStartDate(task))
  if (!start) {
    return {
      start: null,
      endExclusive: null,
      endInclusive: null,
      durationDays: 0,
      source: 'none',
      hasBar: false,
    }
  }

  const effort =
    task.estimatedEffortDays != null && !Number.isNaN(Number(task.estimatedEffortDays))
      ? Math.max(0, Number(task.estimatedEffortDays))
      : null

  if (effort != null && effort > 0) {
    // 予定開始日 + 予定工数
    return buildRange(start, effort, 'start+effort')
  }

  // 工数未設定: 予定開始日の 1 日分
  return buildRange(start, 1, 'start-only')
}

/** タイムライン全体の日付レンジ（予定開始日ベースのバー群から算出） */
export function computeTimelineRange(
  tasks: Task[],
  paddingDays = 3,
): { rangeStart: Date; rangeEndExclusive: Date; totalDays: number } {
  const schedules = tasks
    .map(resolveTaskSchedule)
    .filter((s) => s.hasBar && s.start && s.endExclusive)
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

  // 予定終了フラグが見切れないよう、予定終了日もレンジに含める（バー位置は変えない）
  for (const t of tasks) {
    const due = parseDateOnly(getPlannedDueDate(t))
    if (!due) continue
    if (due < min) min = due
    if (due >= maxEx) maxEx = addDays(due, 1)
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
