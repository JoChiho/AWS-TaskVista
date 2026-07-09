// コメント・添付ファイル API 呼び出し層
import apiClient from './client'
import type { Comment, CreateCommentPayload, UploadUrlResponse, GetUploadUrlPayload } from '@/types/comment'
import type { ApiResponse } from '@/types/comment'
import type { Attachment } from '@/types/task'

// ────────────────────────────────────────────
// コメント API
// ────────────────────────────────────────────

/** タスクのコメント一覧を取得する（作成日時昇順） */
export async function fetchComments(taskId: string): Promise<Comment[]> {
  const response = await apiClient.get<ApiResponse<Comment[]>>(`/tasks/${taskId}/comments`)
  return response.data.data
}

/** コメントを作成する */
export async function createComment(
  taskId: string,
  payload: CreateCommentPayload,
): Promise<Comment> {
  const response = await apiClient.post<ApiResponse<Comment>>(
    `/tasks/${taskId}/comments`,
    payload,
  )
  return response.data.data
}

/** コメントを削除する（作成者のみ実行可能） */
export async function deleteComment(taskId: string, commentId: string): Promise<void> {
  await apiClient.delete(`/tasks/${taskId}/comments/${commentId}`)
}

// ────────────────────────────────────────────
// 添付ファイル API
// ────────────────────────────────────────────

/** タスクの添付ファイル一覧を取得する */
export async function fetchAttachments(taskId: string): Promise<Attachment[]> {
  const response = await apiClient.get<ApiResponse<Attachment[]>>(`/tasks/${taskId}/attachments`)
  return response.data.data
}

/**
 * S3 への直接アップロード用のプリサインド PUT URL を取得する
 * Lambda の 6MB 制限を回避するため、フロントエンドから S3 へ直接アップロードする
 */
export async function getUploadUrl(
  taskId: string,
  payload: GetUploadUrlPayload,
): Promise<UploadUrlResponse> {
  const response = await apiClient.post<ApiResponse<UploadUrlResponse>>(
    `/tasks/${taskId}/attachments/upload-url`,
    payload,
  )
  return response.data.data
}

/** S3 からのダウンロード用のプリサインド GET URL を取得する */
export async function getDownloadUrl(
  taskId: string,
  attachmentId: string,
): Promise<string> {
  const response = await apiClient.get<ApiResponse<{ downloadUrl: string }>>(
    `/tasks/${taskId}/attachments/${attachmentId}/download-url`,
  )
  return response.data.data.downloadUrl
}

/** 添付ファイルを削除する（S3 からも削除される） */
export async function deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
  await apiClient.delete(`/tasks/${taskId}/attachments/${attachmentId}`)
}
