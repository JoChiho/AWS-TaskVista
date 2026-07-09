import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getPathParam, getRequestPath, parseBody } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as service from './service.js'

/** Attachments Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'ATTACHMENTS', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const taskId = getPathParam(event, 'taskId')
    const attachmentId = getPathParam(event, 'attachmentId')
    const path = getRequestPath(event)

    if (!taskId) {
      return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
    }

    if (method === 'GET' && path.endsWith('/attachments')) {
      const attachments = await service.listAttachments(taskId, user.userId)
      logInfo(correlationId, '添付ファイル一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'LIST_ATTACHMENTS',
      })
      return successResponse(200, attachments, correlationId)
    }

    if (method === 'POST' && path.endsWith('/upload-url')) {
      const result = await service.getUploadUrl(taskId, user.userId, parseBody(event))
      logInfo(correlationId, 'アップロード URL を発行しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: result.attachmentId,
        action: 'CREATE_UPLOAD_URL',
      })
      return successResponse(200, result, correlationId)
    }

    if (method === 'GET' && attachmentId && path.endsWith('/download-url')) {
      const downloadUrl = await service.getDownloadUrl(taskId, attachmentId, user.userId)
      logInfo(correlationId, 'ダウンロード URL を発行しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: attachmentId,
        action: 'CREATE_DOWNLOAD_URL',
      })
      return successResponse(200, { downloadUrl }, correlationId)
    }

    if (method === 'DELETE' && attachmentId) {
      await service.deleteAttachment(taskId, attachmentId, user.userId)
      logInfo(correlationId, '添付ファイルを削除しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: attachmentId,
        action: 'DELETE_ATTACHMENT',
      })
      return successResponse(200, { success: true }, correlationId)
    }

    return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
  })
}