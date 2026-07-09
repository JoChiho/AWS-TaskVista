import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getRequestPath } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as service from './service.js'

/** Dashboard Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'DASHBOARD', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const path = getRequestPath(event)

    if (method === 'GET' && path === '/dashboard/summary') {
      const summary = await service.getSummary(user.userId, user.email, user.name)
      logInfo(correlationId, 'ダッシュボード統計を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'DASHBOARD_SUMMARY',
      })
      return successResponse(200, summary, correlationId)
    }

    if (method === 'GET' && path === '/dashboard/my-tasks') {
      const tasks = await service.getMyTasks(user.userId)
      logInfo(correlationId, '担当タスク一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'DASHBOARD_MY_TASKS',
      })
      return successResponse(200, tasks, correlationId)
    }

    return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
  })
}