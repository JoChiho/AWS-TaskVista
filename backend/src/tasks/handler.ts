import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { getAuthUser, getPathParam, getRequestPath, parseBody } from '../shared/context.js'
import { withHandler } from '../shared/handler.js'
import { logInfo } from '../shared/logger.js'
import { errorResponse, successResponse } from '../shared/response.js'
import * as service from './service.js'

/** Tasks Lambda エントリポイント */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  return withHandler(event, 'TASKS', async (correlationId) => {
    const method = event.requestContext.http.method
    const user = getAuthUser(event)
    const projectId = getPathParam(event, 'projectId')
    const taskId = getPathParam(event, 'taskId')
    const path = getRequestPath(event)

    if (method === 'GET' && projectId && path.endsWith('/tasks')) {
      const tasks = await service.listTasksByProject(projectId, user.userId)
      logInfo(correlationId, 'タスク一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'LIST_TASKS',
      })
      return successResponse(200, tasks, correlationId)
    }

    if (method === 'POST' && projectId && path.endsWith('/tasks')) {
      const task = await service.createTask(projectId, user.userId, parseBody(event))
      logInfo(correlationId, 'タスクを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: task.taskId,
        action: 'CREATE_TASK',
      })
      return successResponse(201, task, correlationId)
    }

    if (method === 'GET' && taskId && !path.includes('/status')) {
      const task = await service.getTask(taskId, user.userId)
      logInfo(correlationId, 'タスク詳細を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'GET_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    if (method === 'PUT' && taskId) {
      const task = await service.updateTask(taskId, user.userId, parseBody(event))
      logInfo(correlationId, 'タスクを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'UPDATE_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    if (method === 'PATCH' && taskId && path.endsWith('/status')) {
      const task = await service.updateTaskStatus(taskId, user.userId, parseBody(event))
      logInfo(correlationId, 'タスクのステータスを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'UPDATE_TASK_STATUS',
      })
      return successResponse(200, task, correlationId)
    }

    if (method === 'DELETE' && taskId) {
      const task = await service.deleteTask(taskId, user.userId)
      logInfo(correlationId, 'タスクを削除しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'DELETE_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    return errorResponse(404, 'NOT_FOUND', 'ルートが見つかりません', correlationId)
  })
}