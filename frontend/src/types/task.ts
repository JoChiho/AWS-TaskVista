// タスク関連の型定義

/**
 * タスクのステータス値（日本語固定）
 * かんばんの列とステータス更新 API で使用する
 */
export type TaskStatus = '未着手' | '進行中' | 'レビュー待ち' | '完了' | '保留'

/** タスクの優先度 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

/** 優先度の日本語表示ラベル */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '緊急',
}

/** 優先度のカラーマッピング（Vuetify カラー） */
export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  urgent: 'error',
}

/** タスクステータスの一覧（表示順） */
export const TASK_STATUSES: TaskStatus[] = [
  '未着手',
  '進行中',
  'レビュー待ち',
  '完了',
  '保留',
]

/** ステータスのカラーマッピング（Vuetify カラー） */
export const STATUS_COLORS: Record<TaskStatus, string> = {
  未着手: 'grey',
  進行中: 'primary',
  レビュー待ち: 'warning',
  完了: 'success',
  保留: 'error',
}

/** 添付ファイルのメタデータ */
export interface Attachment {
  attachmentId: string
  filename: string
  s3Key: string
  contentType: string
  sizeBytes: number
  uploadedBy: string
  uploadedAt: string
}

/** タスク担当者（複数対応） */
export interface TaskAssignee {
  userId?: string
  displayName: string
}

/** 評価者（レビュー待ち向け・複数可） */
export type TaskReviewer = TaskAssignee

/** タスクエンティティ */
export interface Task {
  taskId: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  requirement?: string
  /** 主担当（後方互換・assignees[0] と同期） */
  assigneeId?: string
  assigneeName?: string
  /** 担当者一覧（1 人以上可） */
  assignees?: TaskAssignee[]
  /** 評価者一覧（主に status=レビュー待ち） */
  reviewers?: TaskReviewer[]
  /** 完了度 0〜100（%） */
  completionPercent?: number
  /** 予定工数（人日） */
  estimatedEffortDays?: number
  /** 実績工数（人日） */
  actualEffortDays?: number
  /** 予定開始日（YYYY-MM-DD） */
  plannedStartDate?: string
  /** 予定終了日（YYYY-MM-DD） */
  plannedDueDate?: string
  /** 実績開始日（YYYY-MM-DD） */
  actualStartDate?: string
  /** 実績終了日（YYYY-MM-DD） */
  actualDueDate?: string
  /**
   * 旧フィールド互換（API は planned* を返す）
   * @deprecated
   */
  startDate?: string
  /** @deprecated 互換用。表示は plannedDueDate を使う */
  dueDate?: string
  /** WBS: 親タスク ID（未設定 = ルート） */
  parentTaskId?: string
  /** WBS 番号（例: 1.2） */
  wbsCode?: string
  /** 同一親内の並び */
  sortOrder?: number
  /** ノード種別 */
  nodeType?: TaskNodeType
  /** 直接の子の数（API 集計） */
  childCount?: number
  /** 子から集計した値（親ノード） */
  rollup?: TaskRollup
  attachments: Attachment[]
  createdBy: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  commentCount?: number
}

export type TaskNodeType = 'summary' | 'work_package' | 'milestone'

export type ParentStatusMode =
  /** 途中（進行中・完了+未着手混在など）→ 親は進行中固定 */
  | 'forced_progress'
  /** 子がすべて完了 → 完了 / レビュー待ち */
  | 'all_done_choice'
  /** 全未着手 or 全保留 */
  | 'idle_choice'

export interface TaskRollup {
  childCount: number
  estimatedEffortDaysSum: number
  actualEffortDaysSum: number
  completionPercent: number
  plannedStartDate?: string
  plannedDueDate?: string
  actualStartDate?: string
  actualDueDate?: string
  status: TaskStatus
  statusMode: ParentStatusMode
  allowedStatuses: TaskStatus[]
  assignees: TaskAssignee[]
}

/** タスク作成リクエスト */
export interface CreateTaskPayload {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  requirement?: string
  assigneeId?: string
  assigneeName?: string
  assignees?: TaskAssignee[]
  reviewers?: TaskReviewer[]
  completionPercent?: number
  estimatedEffortDays?: number | null
  actualEffortDays?: number | null
  plannedStartDate?: string | null
  plannedDueDate?: string | null
  actualStartDate?: string | null
  actualDueDate?: string | null
  parentTaskId?: string | null
  wbsCode?: string | null
  sortOrder?: number | null
  nodeType?: TaskNodeType | null
}

/** タスク更新リクエスト */
export interface UpdateTaskPayload {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  requirement?: string
  assigneeId?: string
  assigneeName?: string
  assignees?: TaskAssignee[]
  reviewers?: TaskReviewer[]
  completionPercent?: number
  estimatedEffortDays?: number | null
  actualEffortDays?: number | null
  plannedStartDate?: string | null
  plannedDueDate?: string | null
  actualStartDate?: string | null
  actualDueDate?: string | null
  parentTaskId?: string | null
  wbsCode?: string | null
  sortOrder?: number | null
  nodeType?: TaskNodeType | null
}

/** 予定開始日（旧 startDate フォールバック） */
export function getPlannedStartDate(task: Pick<Task, 'plannedStartDate' | 'startDate'>): string | undefined {
  return task.plannedStartDate || task.startDate || undefined
}

/** 予定終了日（旧 dueDate フォールバック） */
export function getPlannedDueDate(task: Pick<Task, 'plannedDueDate' | 'dueDate'>): string | undefined {
  return task.plannedDueDate || task.dueDate || undefined
}

/**
 * 予定終了の超過ハイライトを出すか
 * 完了 / レビュー待ち / 保留 は期限超過を強調しない
 */
export function shouldHighlightPlannedDue(
  status?: TaskStatus | null,
): boolean {
  if (!status) return true
  return status !== '完了' && status !== 'レビュー待ち' && status !== '保留'
}

/** 予定終了日が超過しているか（対象外ステータスは false） */
export function isPlannedDueOverdue(
  dueDate?: string | null,
  status?: TaskStatus | null,
): boolean {
  if (!shouldHighlightPlannedDue(status)) return false
  if (!dueDate) return false
  const d = new Date(dueDate)
  if (Number.isNaN(d.getTime())) return false
  d.setHours(23, 59, 59, 999)
  return d < new Date()
}

/** 予定終了が近い（3日以内・超過ハイライト対象のみ） */
export function isPlannedDueSoon(
  dueDate?: string | null,
  status?: TaskStatus | null,
): boolean {
  if (!shouldHighlightPlannedDue(status)) return false
  if (!dueDate) return false
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return false
  const now = new Date()
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff <= 3
}

/** ステータスのみ更新するリクエスト（かんばんドラッグ専用） */
export interface UpdateTaskStatusPayload {
  status: TaskStatus
}

/** かんばんビュー用のステータス別タスクグループ */
export type TasksByStatus = Record<TaskStatus, Task[]>

/** 完了度を 0〜100 に正規化 */
export function normalizeCompletion(value?: number | null): number {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return 0
  return Math.min(100, Math.max(0, Math.round(Number(value))))
}

/** 完了度の進捗バー色 */
export function completionColor(percent: number): string {
  if (percent >= 100) return 'success'
  if (percent >= 70) return 'primary'
  if (percent >= 40) return 'info'
  if (percent > 0) return 'warning'
  return 'grey'
}

/**
 * 完了度変更時に自動連動しないステータス
 * （任意の完了度のまま維持できる）
 */
export const COMPLETION_PROTECTED_STATUSES: readonly TaskStatus[] = [
  'レビュー待ち',
  '保留',
]

/** 完了度から連動ステータスを算出（0→未着手 / 1〜99→進行中 / 100→完了） */
export function statusFromCompletion(percent: number): TaskStatus {
  const p = normalizeCompletion(percent)
  if (p <= 0) return '未着手'
  if (p >= 100) return '完了'
  return '進行中'
}

/**
 * 完了度変更後のステータス
 * - レビュー待ち / 保留 は維持
 * - それ以外は完了度に連動
 */
export function resolveStatusAfterCompletionChange(
  completionPercent: number,
  currentStatus: TaskStatus,
): TaskStatus {
  if (COMPLETION_PROTECTED_STATUSES.includes(currentStatus)) {
    return currentStatus
  }
  return statusFromCompletion(completionPercent)
}
