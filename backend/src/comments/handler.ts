import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getPathParam, parseBody } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as service from './service.js'

/** Comments Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'COMMENTS', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const taskId = getPathParam(event, 'taskId')
    const commentId = getPathParam(event, 'commentId')

    if (!taskId) {
      return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
    }

    if (method === 'GET') {
      const comments = await service.listComments(taskId, user.userId, user.email)
      logInfo(correlationId, 'コメント一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'LIST_COMMENTS',
      })
      return successResponse(200, comments, correlationId)
    }

    if (method === 'POST') {
      const comment = await service.createComment(
        taskId,
        user.userId,
        user.name,
        parseBody(event),
        user.email,
      )
      logInfo(correlationId, 'コメントを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: comment.commentId,
        action: 'CREATE_COMMENT',
      })
      return successResponse(201, comment, correlationId)
    }

    if (method === 'DELETE' && commentId) {
      await service.deleteComment(taskId, commentId, user.userId, user.email)
      logInfo(correlationId, 'コメントを削除しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: commentId,
        action: 'DELETE_COMMENT',
      })
      return successResponse(200, { success: true }, correlationId)
    }

    return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
  })
}