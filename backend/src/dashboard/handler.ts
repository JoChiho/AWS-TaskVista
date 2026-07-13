import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getRequestPath, parseBody } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as usersService from '../users/service.js'
import * as service from './service.js'

/** Dashboard + ユーザープロフィール Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'DASHBOARD', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const actor = { userId: user.userId, email: user.email, name: user.name }
    const path = getRequestPath(event)

    // GET /me — クラウド上の表示名プロフィール
    if (method === 'GET' && path === '/me') {
      const profile = await usersService.getMyProfile(actor)
      logInfo(correlationId, 'プロフィールを取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'GET_ME',
      })
      return successResponse(
        200,
        profile ?? {
          userId: user.userId,
          email: user.email,
          displayName: null,
          hasDisplayName: false,
        },
        correlationId,
      )
    }

    // PUT /me — 表示名をクラウドに保存
    if (method === 'PUT' && path === '/me') {
      const profile = await usersService.updateMyProfile(actor, parseBody(event))
      logInfo(correlationId, 'プロフィールを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'UPDATE_ME',
      })
      return successResponse(200, { ...profile, hasDisplayName: true }, correlationId)
    }

    // POST /users/display-names — 複数 userId の表示名を一括取得（他ユーザー名の統一表示用）
    if (method === 'POST' && path === '/users/display-names') {
      const body = parseBody<{ userIds?: string[] }>(event)
      const userIds = Array.isArray(body?.userIds) ? body.userIds : []
      const map = await usersService.getDisplayNameMap(userIds)
      const names: Record<string, string> = {}
      for (const [id, name] of map) {
        names[id] = name
      }
      logInfo(correlationId, '表示名を一括取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'LOOKUP_DISPLAY_NAMES',
      })
      return successResponse(200, { names }, correlationId)
    }

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
      const tasks = await service.getMyTasks(user.userId, user.email, user.name)
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