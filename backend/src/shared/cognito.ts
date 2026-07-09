/**
 * Cognito User Pool からメールでユーザーを解決する
 * 招待時に sub を即時 memberIds へ入れるために使用する
 */
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider'

const client = new CognitoIdentityProviderClient({})

export interface CognitoResolvedUser {
  userId: string
  email: string
  displayName: string
}

function attrsToMap(attrs: AttributeType[] | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const a of attrs ?? []) {
    if (a.Name && a.Value !== undefined) {
      map[a.Name] = a.Value
    }
  }
  return map
}

function escapeFilterValue(value: string): string {
  // Cognito Filter は " で囲む。値内の " を除去する
  return value.replace(/"/g, '').trim()
}

/**
 * メールアドレスで Cognito ユーザーを検索する
 * 見つからない場合は null（招待メールのみ保存し、ログイン時に紐づける）
 */
export async function findCognitoUserByEmail(
  email: string,
): Promise<CognitoResolvedUser | null> {
  const userPoolId = process.env.COGNITO_USER_POOL_ID
  if (!userPoolId) {
    console.warn('COGNITO_USER_POOL_ID が未設定のため Cognito 検索をスキップします')
    return null
  }

  const normalized = escapeFilterValue(email).toLowerCase()
  if (!normalized || !normalized.includes('@')) return null

  try {
    const result = await client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${normalized}"`,
        Limit: 5,
      }),
    )

    const user = result.Users?.[0]
    if (!user) return null

    const attrs = attrsToMap(user.Attributes)
    const userId = attrs.sub
    if (!userId) return null

    const displayName =
      attrs.name ||
      attrs.preferred_username ||
      attrs.email?.split('@')[0] ||
      normalized.split('@')[0] ||
      normalized

    return {
      userId,
      email: (attrs.email || normalized).toLowerCase(),
      displayName,
    }
  } catch (error) {
    // IAM 不足などでも招待自体はメールベースで継続できるようにする
    console.error('Cognito ListUsers に失敗しました（メール招待にフォールバック）:', error)
    return null
  }
}
