/** プロジェクトメンバー（表示用メタデータ） */
export interface ProjectMember {
  /** Cognito sub（招待直後は未確定の場合がある） */
  userId?: string
  /** 招待・識別用メールアドレス（小文字推奨） */
  email: string
  /** 画面表示用の名前 */
  displayName: string
}

/** プロジェクトエンティティ */
export interface Project {
  projectId: string
  name: string
  description?: string
  status: 'active' | 'archived'
  createdBy: string
  /** アクセス制御用の Cognito sub 一覧 */
  memberIds: string[]
  /** アクセス制御用のメール一覧（小文字） */
  memberEmails?: string[]
  /** メンバー表示情報 */
  members?: ProjectMember[]
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

/** プロジェクトへのアクセス権限を確認する（sub または招待メール） */
export function canAccessProject(
  project: Project,
  userId: string,
  email?: string,
): boolean {
  if (project.isDeleted) return false
  if (project.createdBy === userId || project.memberIds.includes(userId)) {
    return true
  }
  if (project.members?.some((m) => m.userId === userId)) {
    return true
  }
  const normalized = email?.trim().toLowerCase()
  if (normalized) {
    if (project.memberEmails?.includes(normalized)) return true
    if (project.members?.some((m) => m.email.toLowerCase() === normalized)) return true
  }
  return false
}