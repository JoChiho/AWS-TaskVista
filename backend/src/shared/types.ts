/** プロジェクトメンバー（表示用メタデータ） */
export interface ProjectMember {
  /** Cognito sub（招待直後は未確定の場合がある） */
  userId?: string
  /** 招待・識別用メールアドレス（小文字推奨） */
  email: string
  /** 画面表示用の名前 */
  displayName: string
}

/** プロジェクトのステータス */
export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'archived'

/** プロジェクトエンティティ */
export interface Project {
  projectId: string
  name: string
  description?: string
  status: ProjectStatus
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

/** タスク担当者（複数対応） */
export interface TaskAssignee {
  /** Cognito sub（メンバー選択時） */
  userId?: string
  /** 表示名 */
  displayName: string
}

/** レビュー評価者（レビュー待ち向け・複数可） */
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
  /**
   * 主担当（後方互換・AssigneeIndex 用）
   * 常に assignees[0] と同期する
   */
  assigneeId?: string
  assigneeName?: string
  /** 担当者一覧（1 人以上可） */
  assignees?: TaskAssignee[]
  /**
   * 評価者一覧（主に status=レビュー待ち）
   * プロジェクトメンバーから選択
   */
  reviewers?: TaskReviewer[]
  /** 完了度 0〜100（%） */
  completionPercent?: number
  /** 予定工数（人日） */
  estimatedEffortDays?: number
  /** 実績工数（人日） */
  actualEffortDays?: number
  /**
   * 予定開始日（YYYY-MM-DD）
   * 予定工数と組み合わせてタイムライン上の期間を表す
   */
  plannedStartDate?: string
  /** 予定終了日（YYYY-MM-DD） */
  plannedDueDate?: string
  /** 実績開始日（YYYY-MM-DD） */
  actualStartDate?: string
  /** 実績終了日（YYYY-MM-DD） */
  actualDueDate?: string
  /**
   * AssigneeIndex のソートキー互換用（= plannedDueDate をミラー）
   * API 利用側は plannedDueDate を参照すること
   */
  dueDate?: string
  /**
   * 旧フィールド（読み取り互換のみ。新規書き込みは plannedStartDate を使う）
   * @deprecated
   */
  startDate?: string
  /**
   * WBS: 親タスク ID。未設定 = プロジェクト直下のルート
   */
  parentTaskId?: string
  /** WBS 番号（例: "1", "1.2"） */
  wbsCode?: string
  /** 同一親内の並び順（0 始まり） */
  sortOrder?: number
  /**
   * ノード種別
   * - summary: 集計向け
   * - work_package: 実行単位（既定）
   * - milestone: マイルストーン
   */
  nodeType?: TaskNodeType
  /**
   * 読取時のみ: 直接の子の数（論理削除除く）
   */
  childCount?: number
  /**
   * 読取時のみ: 子孫から集計した値（子があるとき）
   */
  rollup?: TaskRollup
  attachments: AttachmentMeta[]
  createdBy: string
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

/** WBS ノード種別 */
export type TaskNodeType = 'summary' | 'work_package' | 'milestone'

/**
 * 親ステータスの制約モード
 * - forced_progress: 作業が途中（進行中/レビュー待ち/完了と未着手の混在など）→ 親は必ず進行中
 * - all_done_choice: 子がすべて完了 → 親は完了 / レビュー待ちを手動選択可
 * - idle_choice: 全未着手 or 全保留 → 未着手 / 保留を手動選択可
 */
export type ParentStatusMode =
  | 'forced_progress'
  | 'all_done_choice'
  | 'idle_choice'

/** 親ノード向け集計（API 応答） */
export interface TaskRollup {
  childCount: number
  estimatedEffortDaysSum: number
  actualEffortDaysSum: number
  completionPercent: number
  plannedStartDate?: string
  plannedDueDate?: string
  actualStartDate?: string
  actualDueDate?: string
  /** 表示用の有効ステータス（強制時は進行中） */
  status: TaskStatus
  statusMode: ParentStatusMode
  /** 親が手動で選べるステータス */
  allowedStatuses: TaskStatus[]
  /** 子孫の担当者の和集合 */
  assignees: TaskAssignee[]
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
  /** プロジェクトステータス */
  status: ProjectStatus
  /** メンバー数（作成者含む） */
  memberCount: number
  /**
   * 更新日: プロジェクト内タスクの最新 updatedAt
   * タスクが無い場合はプロジェクト自体の updatedAt
   */
  lastUpdatedAt: string
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