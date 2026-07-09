import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { docClient, getCommentsTable } from '../shared/dynamodb.js'
import type { Comment } from '../shared/types.js'

const TABLE = () => getCommentsTable()

function commentKey(taskId: string, commentId: string) {
  return { taskId, commentId }
}

/** コメントを ID で取得する */
export async function getCommentById(
  taskId: string,
  commentId: string,
): Promise<Comment | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE(),
      Key: commentKey(taskId, commentId),
    }),
  )
  return (result.Item as Comment | undefined) ?? null
}

/**
 * タスクのコメント一覧を取得する（作成日時昇順）
 * テーブル PK は (taskId, commentId) なのでベーステーブルを Query する。
 * GSI 経由だと整合遅延や取り違えの余地があるため使わない。
 */
export async function listCommentsByTask(taskId: string): Promise<Comment[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      KeyConditionExpression: 'taskId = :taskId',
      ExpressionAttributeValues: { ':taskId': taskId },
    }),
  )
  const items = ((result.Items as Comment[] | undefined) ?? []).filter(
    (c) => c.taskId === taskId,
  )
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** コメントを新規作成する */
export async function createComment(comment: Comment): Promise<Comment> {
  if (!comment.taskId || !comment.commentId) {
    throw new Error('taskId と commentId は必須です')
  }
  await docClient.send(
    new PutCommand({
      TableName: TABLE(),
      Item: comment,
      ConditionExpression:
        'attribute_not_exists(taskId) AND attribute_not_exists(commentId)',
    }),
  )
  return comment
}

/** コメントを削除する（ハード削除） */
export async function deleteComment(taskId: string, commentId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE(),
      Key: commentKey(taskId, commentId),
    }),
  )
}