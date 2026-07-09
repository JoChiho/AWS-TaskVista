// プロジェクト API 呼び出し層
import apiClient from './client'
import type {
  Project,
  CreateProjectPayload,
  UpdateProjectPayload,
  AddProjectMemberPayload,
} from '@/types/project'
import type { ApiResponse } from '@/types/comment'

/** プロジェクト一覧を取得する */
export async function fetchProjects(): Promise<Project[]> {
  const response = await apiClient.get<ApiResponse<Project[]>>('/projects')
  return response.data.data
}

/** プロジェクト詳細を取得する */
export async function fetchProject(projectId: string): Promise<Project> {
  const response = await apiClient.get<ApiResponse<Project>>(`/projects/${projectId}`)
  return response.data.data
}

/** 新しいプロジェクトを作成する */
export async function createProject(payload: CreateProjectPayload): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>('/projects', payload)
  return response.data.data
}

/** プロジェクト情報を更新する */
export async function updateProject(
  projectId: string,
  payload: UpdateProjectPayload,
): Promise<Project> {
  const response = await apiClient.put<ApiResponse<Project>>(`/projects/${projectId}`, payload)
  return response.data.data
}

/** プロジェクトメンバーを追加する */
export async function addProjectMember(
  projectId: string,
  payload: AddProjectMemberPayload,
): Promise<Project> {
  const response = await apiClient.post<ApiResponse<Project>>(
    `/projects/${projectId}/members`,
    payload,
  )
  return response.data.data
}

/** プロジェクトメンバーを削除する（email または userId） */
export async function removeProjectMember(
  projectId: string,
  memberKey: string,
): Promise<Project> {
  const response = await apiClient.delete<ApiResponse<Project>>(
    `/projects/${projectId}/members/${encodeURIComponent(memberKey)}`,
  )
  return response.data.data
}

/** プロジェクトを論理削除する */
export async function deleteProject(projectId: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}`)
}
