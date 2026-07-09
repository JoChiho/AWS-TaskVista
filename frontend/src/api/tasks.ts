// タスク API 呼び出し層
import apiClient from './client'
import type {
  Task,
  CreateTaskPayload,
  UpdateTaskPayload,
  UpdateTaskStatusPayload,
} from '@/types/task'
import type { ApiResponse } from '@/types/comment'

/** プロジェクト内のタスク一覧を取得する */
export async function fetchTasks(projectId: string): Promise<Task[]> {
  const response = await apiClient.get<ApiResponse<Task[]>>(`/projects/${projectId}/tasks`)
  return response.data.data
}

/** タスク詳細を取得する（コメント数を含む） */
export async function fetchTask(taskId: string): Promise<Task> {
  const response = await apiClient.get<ApiResponse<Task>>(`/tasks/${taskId}`)
  return response.data.data
}

/** プロジェクト内に新しいタスクを作成する */
export async function createTask(
  projectId: string,
  payload: CreateTaskPayload,
): Promise<Task> {
  const response = await apiClient.post<ApiResponse<Task>>(
    `/projects/${projectId}/tasks`,
    payload,
  )
  return response.data.data
}

/** タスク情報を更新する */
export async function updateTask(taskId: string, payload: UpdateTaskPayload): Promise<Task> {
  const response = await apiClient.put<ApiResponse<Task>>(`/tasks/${taskId}`, payload)
  return response.data.data
}

/**
 * タスクのステータスのみを更新する
 * かんばんのドラッグ＆ドロップ操作専用のエンドポイント
 */
export async function updateTaskStatus(
  taskId: string,
  payload: UpdateTaskStatusPayload,
): Promise<Task> {
  const response = await apiClient.patch<ApiResponse<Task>>(
    `/tasks/${taskId}/status`,
    payload,
  )
  return response.data.data
}

/** タスクを論理削除する */
export async function deleteTask(taskId: string): Promise<void> {
  await apiClient.delete(`/tasks/${taskId}`)
}
