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

/** タスクエンティティ */
export interface Task {
  taskId: string
  projectId: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  location?: string
  requirement?: string
  assigneeId?: string
  assigneeName?: string
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
  location?: string
  requirement?: string
  assigneeId?: string
  dueDate?: string
}

/** タスク更新リクエスト */
export interface UpdateTaskPayload {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  location?: string
  requirement?: string
  assigneeId?: string
  dueDate?: string
}

/** ステータスのみ更新するリクエスト（かんばんドラッグ専用） */
export interface UpdateTaskStatusPayload {
  status: TaskStatus
}

/** かんばんビュー用のステータス別タスクグループ */
export type TasksByStatus = Record<TaskStatus, Task[]>
