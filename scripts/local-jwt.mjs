/**
 * 本地 API 用 JWT / mock 用户解析
 * - Authorization: Bearer <Cognito ID Token> → 解码 payload 作为 claims
 * - LOCAL_DEV=1 时可用 X-Dev-User-* 头 mock 用户（无需登录）
 */

/**
 * @param {import('http').IncomingHttpHeaders} headers
 * @returns {{ sub: string, email?: string, name?: string } | null}
 */
export function resolveLocalClaims(headers) {
  const h = normalizeHeaders(headers)

  if (process.env.LOCAL_DEV === '1') {
    const devSub = h['x-dev-user-sub']
    if (devSub) {
      return {
        sub: devSub,
        email: h['x-dev-user-email'] || `${devSub}@dev.local`,
        name: h['x-dev-user-name'] || 'Local Dev User',
      }
    }
  }

  const auth = h['authorization'] || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) return null

  try {
    return decodeJwtPayload(m[1].trim())
  } catch {
    return null
  }
}

/**
 * Base64URL 解码 JWT payload（本地开发不强制验签；联调时 token 来自真 Cognito）
 * @param {string} token
 */
export function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length < 2) throw new Error('invalid jwt')
  const json = Buffer.from(base64UrlToBase64(parts[1]), 'base64').toString('utf8')
  const payload = JSON.parse(json)
  if (!payload.sub) throw new Error('jwt missing sub')
  return {
    sub: String(payload.sub),
    email: payload.email || payload['custom:email'] || undefined,
    name:
      payload.name ||
      payload.preferred_username ||
      payload.email ||
      payload['cognito:username'] ||
      'ユーザー',
    ...payload,
  }
}

function base64UrlToBase64(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b.length % 4
  if (pad) b += '='.repeat(4 - pad)
  return b
}

function normalizeHeaders(headers) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined) continue
    out[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v)
  }
  return out
}
