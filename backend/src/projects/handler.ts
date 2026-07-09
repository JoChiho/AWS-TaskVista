import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getPathParam, getRequestPath, parseBody } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as service from './service.js'

/** Projects Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'PROJECTS', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const projectId = getPathParam(event, 'projectId')
    const path = getRequestPath(event)

    if (method === 'GET' && path === '/projects') {
      const projects = await service.listProjects(user.userId)
      logInfo(correlationId, 'プロジェクト一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'LIST_PROJECTS',
      })
      return successResponse(200, projects, correlationId)
    }

    if (method === 'POST' && path === '/projects') {
      const project = await service.createProject(user.userId, parseBody(event))
      logInfo(correlationId, 'プロジェクトを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: project.projectId,
        action: 'CREATE_PROJECT',
      })
      return successResponse(201, project, correlationId)
    }

    if (method === 'GET' && projectId) {
      const project = await service.getProject(projectId, user.userId)
      logInfo(correlationId, 'プロジェクト詳細を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'GET_PROJECT',
      })
      return successResponse(200, project, correlationId)
    }

    if (method === 'PUT' && projectId) {
      const project = await service.updateProject(
        projectId,
        user.userId,
        parseBody(event),
      )
      logInfo(correlationId, 'プロジェクトを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'UPDATE_PROJECT',
      })
      return successResponse(200, project, correlationId)
    }

    if (method === 'DELETE' && projectId) {
      const project = await service.deleteProject(projectId, user.userId)
      logInfo(correlationId, 'プロジェクトを削除しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'DELETE_PROJECT',
      })
      return successResponse(200, project, correlationId)
    }

    return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
  })
}