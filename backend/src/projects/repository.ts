import {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { docClient, getProjectsTable } from '../shared/dynamodb.js'
import type { Project } from '../shared/types.js'

const TABLE = () => getProjectsTable()

/** プロジェクトを ID で取得する */
export async function getProjectById(projectId: string): Promise<Project | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE(),
      Key: { projectId },
    }),
  )
  return (result.Item as Project | undefined) ?? null
}

/** 作成者の GSI でプロジェクト一覧を取得する */
export async function listProjectsByCreator(userId: string): Promise<Project[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE(),
      IndexName: 'CreatedByIndex',
      KeyConditionExpression: 'createdBy = :createdBy',
      ExpressionAttributeValues: { ':createdBy': userId },
    }),
  )
  return (result.Items as Project[] | undefined) ?? []
}

/** メンバーとして参加しているプロジェクトをスキャンで取得する */
export async function listProjectsByMember(userId: string): Promise<Project[]> {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: 'contains(memberIds, :userId) AND isDeleted = :false',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':false': false,
      },
    }),
  )
  return (result.Items as Project[] | undefined) ?? []
}

/** 招待メールで参加可能なプロジェクトをスキャンで取得する */
export async function listProjectsByMemberEmail(email: string): Promise<Project[]> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return []

  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE(),
      FilterExpression: 'contains(memberEmails, :email) AND isDeleted = :false',
      ExpressionAttributeValues: {
        ':email': normalized,
        ':false': false,
      },
    }),
  )
  return (result.Items as Project[] | undefined) ?? []
}

/** プロジェクトを新規作成する */
export async function createProject(project: Project): Promise<Project> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE(),
      Item: project,
      ConditionExpression: 'attribute_not_exists(projectId)',
    }),
  )
  return project
}

/** プロジェクトを更新する */
export async function updateProject(
  projectId: string,
  updates: Partial<
    Pick<Project, 'name' | 'description' | 'status' | 'memberIds' | 'memberEmails' | 'members'>
  >,
): Promise<Project> {
  const expressions: string[] = ['updatedAt = :updatedAt']
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() }
  const names: Record<string, string> = {}

  if (updates.name !== undefined) {
    expressions.push('#name = :name')
    names['#name'] = 'name'
    values[':name'] = updates.name
  }
  if (updates.description !== undefined) {
    expressions.push('description = :description')
    values[':description'] = updates.description
  }
  if (updates.status !== undefined) {
    expressions.push('#status = :status')
    names['#status'] = 'status'
    values[':status'] = updates.status
  }
  if (updates.memberIds !== undefined) {
    expressions.push('memberIds = :memberIds')
    values[':memberIds'] = updates.memberIds
  }
  if (updates.memberEmails !== undefined) {
    expressions.push('memberEmails = :memberEmails')
    values[':memberEmails'] = updates.memberEmails
  }
  if (updates.members !== undefined) {
    expressions.push('members = :members')
    values[':members'] = updates.members
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { projectId },
      UpdateExpression: `SET ${expressions.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  )

  return result.Attributes as Project
}

/** プロジェクトを論理削除する */
export async function softDeleteProject(projectId: string): Promise<Project> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE(),
      Key: { projectId },
      UpdateExpression: 'SET isDeleted = :true, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':true': true,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    }),
  )
  return result.Attributes as Project
}