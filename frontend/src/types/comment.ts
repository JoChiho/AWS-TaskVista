// コメント・添付ファイル関連の型定義

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

/** コメント作成リクエスト */
export interface CreateCommentPayload {
  content: string
}

/** 添付ファイルアップロード URL リクエスト */
export interface GetUploadUrlPayload {
  filename: string
  contentType: string
  sizeBytes: number
}

/** アップロード URL レスポンス */
export interface UploadUrlResponse {
  uploadUrl: string
  attachmentId: string
  s3Key: string
}

/** API 共通レスポンス型 */
export interface ApiResponse<T> {
  data: T
  meta: {
    correlationId: string
    timestamp: string
  }
}

/** API エラーレスポンス型 */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
  meta: {
    correlationId: string
    timestamp: string
  }
}
