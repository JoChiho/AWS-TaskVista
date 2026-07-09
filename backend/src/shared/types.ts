/** プロジェクトエンティティ */
export interface Project {
  projectId: string
  name: string
  description?: string
  status: 'active' | 'archived'
  createdBy: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

/** タスクステータス（日本語固定） */
export type TaskStatus = '未着手' | '進行中' | 'レビュー待ち' | '完了' | '保留'

/** タスク優先度 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

/** 添付ファイルメタデータ */
export interface AttachmentMeta {
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
  attachments: AttachmentMeta[]
  createdBy: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

/** コメントエンティティ */
export interface Comment {
  commentId: string
  taskId: string
  content: string
  authorId: string
  authorName: string
  createdAt: string
  updatedAt: string
}

/** ダッシュボード用プロジェクト概要 */
export interface ProjectSummary {
  projectId: string
  name: string
  totalTasks: number
  tasksByStatus: Record<string, number>
}

export const TASK_STATUSES: TaskStatus[] = [
  '未着手',
  '進行中',
  'レビュー待ち',
  '完了',
  '保留',
]

/** プロジェクトへのアクセス権限を確認する */
export function canAccessProject(project: Project, userId: string): boolean {
  if (project.isDeleted) return false
  return project.createdBy === userId || project.memberIds.includes(userId)
}