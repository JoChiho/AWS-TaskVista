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

    // ── プロジェクト配下 ──

    // POST /projects/{projectId}/tasks/reorder
    if (method === 'POST' && projectId && path.endsWith('/tasks/reorder')) {
      const tasks = await service.reorderSiblingTasks(
        projectId,
        user.userId,
        parseBody(event),
        user.email,
      )
      logInfo(correlationId, 'タスクの並びを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'REORDER_TASKS',
      })
      return successResponse(200, tasks, correlationId)
    }

    // POST /projects/{projectId}/wbs/renumber
    if (method === 'POST' && projectId && path.endsWith('/wbs/renumber')) {
      const tasks = await service.renumberProjectWbs(projectId, user.userId, user.email)
      logInfo(correlationId, 'WBS 番号を振り直しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'RENUMBER_WBS',
      })
      return successResponse(200, tasks, correlationId)
    }

    // GET|POST /projects/{projectId}/tasks
    if (method === 'GET' && projectId && path.endsWith('/tasks')) {
      const tasks = await service.listTasksByProject(projectId, user.userId, user.email)
      logInfo(correlationId, 'タスク一覧を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: projectId,
        action: 'LIST_TASKS',
      })
      return successResponse(200, tasks, correlationId)
    }

    if (method === 'POST' && projectId && path.endsWith('/tasks')) {
      const task = await service.createTask(projectId, user.userId, parseBody(event), user.email)
      logInfo(correlationId, 'タスクを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: task.taskId,
        action: 'CREATE_TASK',
      })
      return successResponse(201, task, correlationId)
    }

    // ── タスク単体（サブパス優先）──

    // POST /tasks/{taskId}/children
    if (method === 'POST' && taskId && path.endsWith('/children')) {
      const task = await service.createChildTask(
        taskId,
        user.userId,
        parseBody(event),
        user.email,
      )
      logInfo(correlationId, '子タスクを作成しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: task.taskId,
        action: 'CREATE_CHILD_TASK',
      })
      return successResponse(201, task, correlationId)
    }

    // POST /tasks/{taskId}/move
    if (method === 'POST' && taskId && path.endsWith('/move')) {
      const task = await service.moveTask(taskId, user.userId, parseBody(event), user.email)
      logInfo(correlationId, 'タスクを移動しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'MOVE_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    // PATCH /tasks/{taskId}/status
    if (method === 'PATCH' && taskId && path.endsWith('/status')) {
      const task = await service.updateTaskStatus(taskId, user.userId, parseBody(event), user.email)
      logInfo(correlationId, 'タスクのステータスを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'UPDATE_TASK_STATUS',
      })
      return successResponse(200, task, correlationId)
    }

    // GET /tasks/{taskId}（サブパスなし）
    if (
      method === 'GET' &&
      taskId &&
      !path.includes('/status') &&
      !path.includes('/children') &&
      !path.includes('/move') &&
      !path.includes('/comments') &&
      !path.includes('/attachments')
    ) {
      const task = await service.getTask(taskId, user.userId, user.email)
      logInfo(correlationId, 'タスク詳細を取得しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'GET_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    // PUT /tasks/{taskId}
    if (
      method === 'PUT' &&
      taskId &&
      !path.endsWith('/status') &&
      !path.endsWith('/children') &&
      !path.endsWith('/move')
    ) {
      const task = await service.updateTask(taskId, user.userId, parseBody(event), user.email)
      logInfo(correlationId, 'タスクを更新しました', {
        requestId: event.requestContext.requestId,
        userId: user.userId,
        resourceId: taskId,
        action: 'UPDATE_TASK',
      })
      return successResponse(200, task, correlationId)
    }

    // DELETE /tasks/{taskId}
    if (
      method === 'DELETE' &&
      taskId &&
      !path.includes('/comments') &&
      !path.includes('/attachments')
    ) {
      const task = await service.deleteTask(taskId, user.userId, user.email)
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
