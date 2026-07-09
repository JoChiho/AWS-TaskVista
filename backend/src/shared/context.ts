import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { v4 as uuidv4 } from 'uuid'
import { UnauthorizedError } from './errors.js'

/** Cognito JWT Authorizer 付きのリクエストコンテキスト */
interface RequestContextWithJwtAuthorizer {
  authorizer?: {
    jwt?: {
      claims?: Record<string, string>
    }
  }
}

/** リクエストから認証済みユーザー情報を取得する */
export interface AuthUser {
  userId: string
  email?: string
  name: string
}

/** API Gateway の stage プレフィックスを除いたリクエストパスを返す */
export function getRequestPath(event: APIGatewayProxyEventV2): string {
  const rawPath = event.rawPath ?? event.requestContext.http.path ?? '/'
  const stage = event.requestContext.stage

  if (stage && stage !== '$default' && rawPath.startsWith(`/${stage}`)) {
    const stripped = rawPath.slice(stage.length + 1)
    return stripped.length > 0 ? stripped : '/'
  }

  return rawPath
}

/** CorrelationId を取得する（ヘッダーがなければ新規生成） */
export function getCorrelationId(event: APIGatewayProxyEventV2): string {
  const headers = event.headers ?? {}
  return headers['x-correlation-id'] ?? headers['X-Correlation-Id'] ?? uuidv4()
}

/** クレームからメールアドレスを可能な限り取り出す */
function extractEmail(claims: Record<string, string>): string | undefined {
  const candidates = [
    claims.email,
    claims['custom:email'],
    // cognito:username がメール形式の場合
    claims['cognito:username'],
    claims.username,
  ]
  for (const c of candidates) {
    if (c && c.includes('@')) {
      return c.trim().toLowerCase()
    }
  }
  return claims.email?.trim().toLowerCase() || undefined
}

/** API Gateway JWT Authorizer からユーザー情報を抽出する */
export function getAuthUser(event: APIGatewayProxyEventV2): AuthUser {
  const requestContext = event.requestContext as APIGatewayProxyEventV2['requestContext'] &
    RequestContextWithJwtAuthorizer
  const claims = requestContext.authorizer?.jwt?.claims
  const userId = claims?.sub

  if (!userId) {
    throw new UnauthorizedError()
  }

  const email = claims ? extractEmail(claims) : undefined

  return {
    userId,
    email,
    name:
      claims?.name ||
      claims?.preferred_username ||
      email ||
      claims?.['cognito:username'] ||
      'ユーザー',
  }
}

/** リクエストボディを JSON としてパースする */
export function parseBody<T>(event: APIGatewayProxyEventV2): T | undefined {
  if (!event.body) return undefined

  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/** パスパラメーターを取得する */
export function getPathParam(
  event: APIGatewayProxyEventV2,
  name: string,
): string | undefined {
  return event.pathParameters?.[name]
}