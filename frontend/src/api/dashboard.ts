// ダッシュボード API 呼び出し層
import apiClient from './client'
import type { ProjectSummary } from '@/types/project'
import type { Task } from '@/types/task'
import type { ApiResponse } from '@/types/comment'

/** プロジェクト横断の統計データを取得する */
export async function fetchDashboardSummary(): Promise<ProjectSummary[]> {
  const response = await apiClient.get<ApiResponse<ProjectSummary[]>>('/dashboard/summary')
  return response.data.data
}

/**
 * 自分が担当するタスクの一覧を取得する
 * 完了済みのタスクを除外し、締切日昇順で返す
 */
export async function fetchMyTasks(): Promise<Task[]> {
  const response = await apiClient.get<ApiResponse<Task[]>>('/dashboard/my-tasks')
  return response.data.data
}

/**
 * 自分が評価者の「レビュー待ち」タスク一覧
 * ダッシュボード「評価待ち」欄用
 */
export async function fetchMyReviewTasks(): Promise<Task[]> {
  const response = await apiClient.get<ApiResponse<Task[]>>('/dashboard/review-tasks')
  return response.data.data
}
