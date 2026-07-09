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

/** タスクのコメント一覧を GSI で取得する（作成日時昇順） */
export async function listCommentsByTask(taskId: string): Promise<Comment[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'TaskCommentsIndex',
      KeyConditionExpression: 'taskId = :taskId',
      ExpressionAttributeValues: { ':taskId': taskId },
      ScanIndexForward: true,
    }),
  )
  return (result.Items as Comment[] | undefined) ?? []
}

/** コメントを新規作成する */
export async function createComment(comment: Comment): Promise<Comment> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE(),
      Item: comment,
      ConditionExpression: 'attribute_not_exists(commentId)',
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