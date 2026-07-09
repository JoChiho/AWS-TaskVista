import {
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { docClient, getTasksTable } from '../shared/dynamodb.js'
import type { AttachmentMeta, Task, TaskStatus } from '../shared/types.js'

const TABLE = () => getTasksTable()

function taskKey(projectId: string, taskId: string) {
  return { projectId, taskId }
}

/** タスクを ID で取得する（TaskIdIndex GSI 経由） */
export async function getTaskById(taskId: string): Promise<Task | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'TaskIdIndex',
      KeyConditionExpression: 'taskId = :taskId',
      ExpressionAttributeValues: { ':taskId': taskId },
      Limit: 1,
    }),
  )
  return (result.Items?.[0] as Task | undefined) ?? null
}

/** プロジェクト内のタスク一覧を GSI で取得する */
export async function listTasksByProject(projectId: string): Promise<Task[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'ProjectStatusIndex',
      KeyConditionExpression: 'projectId = :projectId',
      ExpressionAttributeValues: { ':projectId': projectId },
    }),
  )
  return (result.Items as Task[] | undefined) ?? []
}

/** 担当者の GSI でタスク一覧を取得する */
export async function listTasksByAssignee(assigneeId: string): Promise<Task[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'AssigneeIndex',
      KeyConditionExpression: 'assigneeId = :assigneeId',
      ExpressionAttributeValues: { ':assigneeId': assigneeId },
    }),
  )
  return (result.Items as Task[] | undefined) ?? []
}

/** タスクを新規作成する */
export async function createTask(task: Task): Promise<Task> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE(),
      Item: task,
      ConditionExpression:
        'attribute_not_exists(projectId) AND attribute_not_exists(taskId)',
    }),
  )
  return task
}

/** タスクを更新する */
export async function updateTask(
  taskId: string,
  updates: Partial<
    Pick<
      Task,
      | 'title'
      | 'description'
      | 'status'
      | 'priority'
      | 'requirement'
      | 'assigneeId'
      | 'assigneeName'
      | 'dueDate'
      | 'attachments'
    >
  >,
): Promise<Task> {
  const existing = await getTaskById(taskId)
  if (!existing) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const expressions: string[] = ['updatedAt = :updatedAt']
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }
  const names: Record<string, string> = {}

  const fieldMap: Array<[keyof typeof updates, string]> = [
    ['title', 'title'],
    ['description', 'description'],
    ['status', 'status'],
    ['priority', 'priority'],
    ['requirement', 'requirement'],
    ['assigneeId', 'assigneeId'],
    ['assigneeName', 'assigneeName'],
    ['dueDate', 'dueDate'],
    ['attachments', 'attachments'],
  ]

  for (const [key, attr] of fieldMap) {
    if (updates[key] !== undefined) {
      const placeholder = `#${attr}`
      names[placeholder] = attr
      expressions.push(`${placeholder} = :${attr}`)
      values[`:${attr}`] = updates[key]
    }
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: taskKey(existing.projectId, taskId),
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  )

  return result.Attributes as Task
}

/** タスクのステータスのみを更新する */
export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
  return updateTask(taskId, { status })
}

/** タスクを論理削除する */
export async function softDeleteTask(taskId: string): Promise<Task> {
  const existing = await getTaskById(taskId)
  if (!existing) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: taskKey(existing.projectId, taskId),
      UpdateExpression: 'SET isDeleted = :true, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':true': true,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return result.Attributes as Task
}

/** タスクの添付ファイルメタデータを更新する */
export async function updateTaskAttachments(
  taskId: string,
  attachments: AttachmentMeta[],
): Promise<Task> {
  return updateTask(taskId, { attachments })
}