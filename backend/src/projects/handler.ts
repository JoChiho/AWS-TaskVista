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
    const actor = { userId: user.userId, email: user.email, name: user.name }
    const projectId = getPathParam(event, 'projectId')
    const path = getRequestPath(event)

    // POST /projects/{projectId}/members — メンバー追加
    if (method === 'POST' && projectId && path.endsWith('/members')) {
      const project = await service.addProjectMember(projectId, actor, parseBody(event))
      logInfo(correlationId, 'プロジェクトメンバーを追加しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'ADD_PROJECT_MEMBER',
      })
      return successResponse(200, project, correlationId)
    }

    // DELETE /projects/{projectId}/members/{memberKey} — メンバー削除
    if (method === 'DELETE' && projectId && path.includes('/members/')) {
      const memberKey = getPathParam(event, 'memberKey') ?? path.split('/members/')[1]
      if (!memberKey) {
        return errorResponse(400, 'VALIDATION_ERROR', 'メンバー識別子が必要です', correlationId)
      }
      const decoded = decodeURIComponent(memberKey)
      const project = await service.removeProjectMember(projectId, actor, decoded)
      logInfo(correlationId, 'プロジェクトメンバーを削除しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'REMOVE_PROJECT_MEMBER',
      })
      return successResponse(200, project, correlationId)
    }

    if (method === 'GET' && path === '/projects') {
      const projects = await service.listProjects(actor)
      logInfo(correlationId, 'プロジェクト一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        action: 'LIST_PROJECTS',
      })
      return successResponse(200, projects, correlationId)
    }

    if (method === 'POST' && path === '/projects') {
      const project = await service.createProject(actor, parseBody(event))
      logInfo(correlationId, 'プロジェクトを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: project.projectId,
        action: 'CREATE_PROJECT',
      })
      return successResponse(201, project, correlationId)
    }

    if (method === 'GET' && projectId && !path.includes('/members')) {
      const project = await service.getProject(projectId, actor)
      logInfo(correlationId, 'プロジェクト詳細を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'GET_PROJECT',
      })
      return successResponse(200, project, correlationId)
    }

    if (method === 'PUT' && projectId && !path.includes('/members')) {
      const project = await service.updateProject(projectId, actor, parseBody(event))
      logInfo(correlationId, 'プロジェクトを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'UPDATE_PROJECT',
      })
      return successResponse(200, project, correlationId)
    }

    if (method === 'DELETE' && projectId && !path.includes('/members')) {
      const project = await service.deleteProject(projectId, actor)
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
