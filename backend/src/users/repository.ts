import { GetCommand, PutCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { docClient, getUsersTable } from '../shared/dynamodb.js'

export interface UserProfile {
  userId: string
  email?: string
  displayName: string
  createdAt: string
  updatedAt: string
}

const TABLE = () => getUsersTable()

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE(),
      Key: { userId },
    }),
  )
  return (result.Item as UserProfile | undefined) ?? null
}

export async function putProfile(profile: UserProfile): Promise<UserProfile> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE(),
      Item: profile,
    }),
  )
  return profile
}

/** 最大 100 件まで一括取得（表示名解決用） */
export async function batchGetProfiles(
  userIds: string[],
): Promise<Map<string, UserProfile>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  const map = new Map<string, UserProfile>()
  if (unique.length === 0) return map

  // BatchGet は 100 件まで
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const result = await docClient.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE()]: {
            Keys: chunk.map((userId) => ({ userId })),
          },
        },
      }),
    )
    const items = result.Responses?.[TABLE()] as UserProfile[] | undefined
    for (const item of items ?? []) {
      map.set(item.userId, item)
    }
  }
  return map
}
