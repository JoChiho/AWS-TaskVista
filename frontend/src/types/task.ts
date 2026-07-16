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
  /** 完了度 0〜100（%） */
  completionPercent?: number
  dueDate?: string
  attachments: Attachment[]
  createdBy: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  commentCount?: number
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
  completionPercent?: number
  dueDate?: string
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
  completionPercent?: number
  dueDate?: string
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
