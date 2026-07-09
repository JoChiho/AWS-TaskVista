// プロジェクト関連の型定義

/** プロジェクトのステータス */
export type ProjectStatus = 'active' | 'archived'

/** プロジェクトエンティティ */
export interface Project {
  projectId: string
  name: string
  description?: string
  status: ProjectStatus
  createdBy: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}

/** プロジェクト作成リクエスト */
export interface CreateProjectPayload {
  name: string
  description?: string
}

/** プロジェクト更新リクエスト */
export interface UpdateProjectPayload {
  name?: string
  description?: string
  status?: ProjectStatus
  memberIds?: string[]
}

/** ダッシュボード用のプロジェクト概要 */
export interface ProjectSummary {
  projectId: string
  name: string
  totalTasks: number
  tasksByStatus: Record<string, number>
}
