import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { docClient, getTasksTable } from '../shared/dynamodb.js'
import type { AttachmentMeta, Task, TaskAssignee, TaskStatus } from '../shared/types.js'

const TABLE = () => getTasksTable()

function taskKey(projectId: string, taskId: string) {
  return { projectId, taskId }
}

/**
 * タスクを ID で取得する
 * TaskIdIndex で projectId を特定したあと、ベーステーブル GetItem で全属性を返す。
 * （GSI の Projection が INCLUDE / KEYS_ONLY だと新属性が欠けるため）
 */
export async function getTaskById(taskId: string): Promise<Task | null> {
  const indexed = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'TaskIdIndex',
      KeyConditionExpression: 'taskId = :taskId',
      ExpressionAttributeValues: { ':taskId': taskId },
      Limit: 1,
    }),
  )
  const hint = indexed.Items?.[0] as Task | undefined
  if (!hint?.projectId || !hint?.taskId) {
    return null
  }

  const full = await docClient.send(
    new GetCommand({
      TableName: TABLE(),
      Key: taskKey(hint.projectId, hint.taskId),
    }),
  )
  return (full.Item as Task | undefined) ?? hint
}

/**
 * プロジェクト内のタスク一覧
 * ベーステーブルを projectId で Query し、全属性を確実に返す。
 * ※ 旧実装の ProjectStatusIndex は Projection 次第で新属性が欠落する
 */
export async function listTasksByProject(projectId: string): Promise<Task[]> {
  const items: Task[] = []
  let exclusiveStartKey: Record<string, unknown> | undefined

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE(),
        KeyConditionExpression: 'projectId = :projectId',
        ExpressionAttributeValues: { ':projectId': projectId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    )
    for (const item of result.Items ?? []) {
      items.push(item as Task)
    }
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined
  } while (exclusiveStartKey)

  return items
}

/** 担当者の GSI でタスク一覧を取得する（主担当 assigneeId） */
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

export type TaskUpdateFields = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'requirement'
    | 'assigneeId'
    | 'assigneeName'
    | 'assignees'
    | 'completionPercent'
    | 'attachments'
  >
> & {
  /** 予定工数（人日）。null で属性削除 */
  estimatedEffortDays?: number | null
  /** 実績工数（人日）。null で属性削除 */
  actualEffortDays?: number | null
  /** 予定開始日。null で属性削除 */
  plannedStartDate?: string | null
  /** 予定締切日。null で属性削除 */
  plannedDueDate?: string | null
  /** 実績開始日。null で属性削除 */
  actualStartDate?: string | null
  /** 実績締切日。null で属性削除 */
  actualDueDate?: string | null
  /**
   * AssigneeIndex SK 互換。通常は plannedDueDate と同期して書き込む
   * null で属性削除
   */
  dueDate?: string | null
  /** 旧 startDate の削除用 */
  startDate?: string | null
  /** WBS 親。null で属性削除（ルートへ） */
  parentTaskId?: string | null
  wbsCode?: string | null
  sortOrder?: number | null
  nodeType?: Task['nodeType'] | null
  /** 評価者一覧。null で属性削除 */
  reviewers?: Task['reviewers'] | null
  /** true のとき assigneeId / assigneeName を REMOVE（GSI から外す） */
  clearAssignees?: boolean
}

/** タスクを更新する（予定/実績の日付・工数を含む） */
export async function updateTask(
  taskId: string,
  updates: TaskUpdateFields,
): Promise<Task> {
  const existing = await getTaskById(taskId)
  if (!existing) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const setExpressions: string[] = ['#updatedAt = :updatedAt']
  const removeAttrs: string[] = []
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' }

  // スカラー属性（null = REMOVE、undefined = 触らない）
  const fieldMap: Array<[keyof TaskUpdateFields, string]> = [
    ['title', 'title'],
    ['description', 'description'],
    ['status', 'status'],
    ['priority', 'priority'],
    ['requirement', 'requirement'],
    ['plannedStartDate', 'plannedStartDate'],
    ['plannedDueDate', 'plannedDueDate'],
    ['actualStartDate', 'actualStartDate'],
    ['actualDueDate', 'actualDueDate'],
    ['startDate', 'startDate'],
    ['dueDate', 'dueDate'],
    ['attachments', 'attachments'],
    ['completionPercent', 'completionPercent'],
    ['estimatedEffortDays', 'estimatedEffortDays'],
    ['actualEffortDays', 'actualEffortDays'],
    ['parentTaskId', 'parentTaskId'],
    ['wbsCode', 'wbsCode'],
    ['sortOrder', 'sortOrder'],
    ['nodeType', 'nodeType'],
    ['assignees', 'assignees'],
    ['reviewers', 'reviewers'],
  ]

  for (const [key, attr] of fieldMap) {
    if (updates[key] !== undefined) {
      // null は属性削除（開始日・締切日・予定工数のクリアなど）
      if (updates[key] === null) {
        // REMOVE はプレースホルダ不可の属性名を直接使う（予約語でなければ可）
        // status 等は SET 側で #name を使う
        if (attr === 'status' || attr === 'priority') {
          names[`#${attr}`] = attr
          removeAttrs.push(`#${attr}`)
        } else {
          removeAttrs.push(attr)
        }
        continue
      }
      const nameKey = `#${attr}`
      const valueKey = `:${attr}`
      names[nameKey] = attr
      setExpressions.push(`${nameKey} = ${valueKey}`)
      values[valueKey] = updates[key]
    }
  }

  if (updates.clearAssignees) {
    removeAttrs.push('assigneeId', 'assigneeName')
    // assignees 空配列は SET 側で書く
    if (updates.assignees === undefined) {
      names['#assignees'] = 'assignees'
      setExpressions.push('#assignees = :assignees')
      values[':assignees'] = [] as TaskAssignee[]
    }
  } else {
    if (updates.assigneeId !== undefined) {
      names['#assigneeId'] = 'assigneeId'
      setExpressions.push('#assigneeId = :assigneeId')
      values[':assigneeId'] = updates.assigneeId
    }
    if (updates.assigneeName !== undefined) {
      names['#assigneeName'] = 'assigneeName'
      setExpressions.push('#assigneeName = :assigneeName')
      values[':assigneeName'] = updates.assigneeName
    }
    // 主担当が userId 無し（名前のみ）のとき GSI 用 id を外す
    if (
      updates.assignees !== undefined &&
      updates.assignees.length > 0 &&
      !updates.assigneeId
    ) {
      removeAttrs.push('assigneeId')
    }
  }

  let updateExpression = `SET ${setExpressions.join(', ')}`
  if (removeAttrs.length > 0) {
    updateExpression += ` REMOVE ${removeAttrs.join(', ')}`
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: taskKey(existing.projectId, taskId),
      UpdateExpression: updateExpression,
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

/**
 * 担当者を外す（assigneeId / assigneeName / assignees をクリア）
 * メンバー退出・削除時に呼び、AssigneeIndex からも外れる
 */
export async function clearAssignee(taskId: string): Promise<Task> {
  return updateTask(taskId, {
    clearAssignees: true,
    assignees: [],
  })
}

/**
 * 複数担当のうち指定 userId のみ外す（残った人を主担当に繰り上げ）
 */
export async function removeAssigneeUser(
  taskId: string,
  userId: string,
): Promise<Task> {
  const existing = await getTaskById(taskId)
  if (!existing) {
    throw new Error(`Task not found: ${taskId}`)
  }

  const list =
    existing.assignees && existing.assignees.length > 0
      ? existing.assignees
      : existing.assigneeId || existing.assigneeName
        ? [
            {
              userId: existing.assigneeId,
              displayName: existing.assigneeName || 'ユーザー',
            },
          ]
        : []

  const next = list.filter((a) => a.userId !== userId)
  if (next.length === list.length) {
    return existing
  }

  if (next.length === 0) {
    return clearAssignee(taskId)
  }

  const primary = next[0]
  return updateTask(taskId, {
    assignees: next,
    assigneeId: primary.userId,
    assigneeName: primary.displayName,
    clearAssignees: !primary.userId,
  })
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
