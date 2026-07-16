// プロジェクト関連の型定義

/** プロジェクトのステータス */
export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'archived'

/** ステータスの表示順 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
]

/** ステータスの日本語ラベル */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: '計画中',
  active: '進行中',
  on_hold: '保留',
  completed: '完了',
  archived: 'アーカイブ',
}

/** ステータスの Vuetify カラー */
export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  planning: 'info',
  active: 'success',
  on_hold: 'warning',
  completed: 'primary',
  archived: 'grey',
}

/** セレクト用オプション */
export const PROJECT_STATUS_OPTIONS = PROJECT_STATUSES.map((value) => ({
  title: PROJECT_STATUS_LABELS[value],
  value,
}))

/** 未知の旧値も含めてラベルを返す */
export function projectStatusLabel(status?: string): string {
  if (!status) return '—'
  if (status in PROJECT_STATUS_LABELS) {
    return PROJECT_STATUS_LABELS[status as ProjectStatus]
  }
  // 後方互換
  if (status === 'active') return '進行中'
  return status
}

export function projectStatusColor(status?: string): string {
  if (status && status in PROJECT_STATUS_COLORS) {
    return PROJECT_STATUS_COLORS[status as ProjectStatus]
  }
  return 'grey'
}

/** プロジェクトメンバー */
export interface ProjectMember {
  userId?: string
  email: string
  displayName: string
}

/** プロジェクトエンティティ */
export interface Project {
  projectId: string
  name: string
  description?: string
  status: ProjectStatus
  createdBy: string
  memberIds: string[]
  memberEmails?: string[]
  members?: ProjectMember[]
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

/** プロジェクト作成リクエスト */
export interface CreateProjectPayload {
  name: string
  description?: string
  status?: ProjectStatus
  creatorDisplayName?: string
}

/** プロジェクト更新リクエスト */
export interface UpdateProjectPayload {
  name?: string
  description?: string
  status?: ProjectStatus
  memberIds?: string[]
}

/** メンバー追加リクエスト */
export interface AddProjectMemberPayload {
  email: string
  displayName?: string
}

/** ダッシュボード用のプロジェクト概要 */
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
