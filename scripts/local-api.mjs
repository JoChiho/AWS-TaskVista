#!/usr/bin/env node
/**
 * 本地 Lambda API 网关（Path B，无需 Docker / SAM）
 *
 * 将 HTTP 请求转为 API Gateway HTTP API v2 事件，调用 backend/dist 中的 handler。
 * 数据层默认使用本机 AWS 凭证访问云端 DynamoDB / Cognito / S3。
 *
 * 用法:
 *   npm run local:build
 *   npm run local:api
 *
 * 环境变量:
 *   PORT=3001
 *   LOCAL_DEV=1          # 允许 X-Dev-User-* mock
 *   AWS_REGION=us-east-1
 */
import { createServer } from 'http'
import { pathToFileURL } from 'url'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync } from 'fs'
import { resolveLocalClaims } from './local-jwt.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BACKEND = resolve(ROOT, 'backend')
const DIST = resolve(BACKEND, 'dist')
const PORT = Number(process.env.PORT || 3001)

// 与 deploy.config / 线上一致的表环境
process.env.LOCAL_DEV = process.env.LOCAL_DEV ?? '1'
process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
process.env.PROJECTS_TABLE = process.env.PROJECTS_TABLE ?? 'TaskVista-Projects'
process.env.TASKS_TABLE = process.env.TASKS_TABLE ?? 'TaskVista-Tasks'
process.env.COMMENTS_TABLE = process.env.COMMENTS_TABLE ?? 'TaskVista-Comments'
process.env.ATTACHMENTS_BUCKET = process.env.ATTACHMENTS_BUCKET ?? 'taskvista-attachments'
process.env.COGNITO_USER_POOL_ID =
  process.env.COGNITO_USER_POOL_ID ?? 'us-east-1_PvLPf6TL0'

// 从 deploy.config.json 覆盖（若存在）
try {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'deploy.config.json'), 'utf8'))
  if (cfg.lambdaEnvironment) {
    for (const [k, v] of Object.entries(cfg.lambdaEnvironment)) {
      if (process.env[k] === undefined) process.env[k] = String(v)
    }
  }
  if (cfg.region) process.env.AWS_REGION = cfg.region
  if (cfg.cognito?.userPoolId) process.env.COGNITO_USER_POOL_ID = cfg.cognito.userPoolId
} catch {
  // optional
}

/** @type {Array<{ methods: string[], pattern: RegExp, keys: string[], module: string }>} */
const ROUTES = [
  { methods: ['GET', 'POST'], pattern: /^\/projects\/?$/, keys: [], module: 'projects' },
  {
    methods: ['POST'],
    pattern: /^\/projects\/([^/]+)\/members\/?$/,
    keys: ['projectId'],
    module: 'projects',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/projects\/([^/]+)\/members\/([^/]+)\/?$/,
    keys: ['projectId', 'memberKey'],
    module: 'projects',
  },
  {
    methods: ['GET', 'PUT', 'DELETE'],
    pattern: /^\/projects\/([^/]+)\/?$/,
    keys: ['projectId'],
    module: 'projects',
  },
  {
    methods: ['GET', 'POST'],
    pattern: /^\/projects\/([^/]+)\/tasks\/?$/,
    keys: ['projectId'],
    module: 'tasks',
  },
  {
    methods: ['PATCH'],
    pattern: /^\/tasks\/([^/]+)\/status\/?$/,
    keys: ['taskId'],
    module: 'tasks',
  },
  {
    methods: ['GET', 'POST'],
    pattern: /^\/tasks\/([^/]+)\/comments\/?$/,
    keys: ['taskId'],
    module: 'comments',
  },
  {
    methods: ['DELETE'],
    pattern: /^\/tasks\/([^/]+)\/comments\/([^/]+)\/?$/,
    keys: ['taskId', 'commentId'],
    module: 'comments',
  },
  {
    methods: ['POST'],
    pattern: /^\/tasks\/([^/]+)\/attachments\/upload-url\/?$/,
    keys: ['taskId'],
    module: 'attachments',
  },
  {
    methods: ['GET'],
    pattern: /^\/tasks\/([^/]+)\/attachments\/([^/]+)\/download-url\/?$/,
    keys: ['taskId', 'attachmentId'],
    module: 'attachments',
  },
  {
    methods: ['GET', 'DELETE'],
    pattern: /^\/tasks\/([^/]+)\/attachments\/([^/]+)\/?$/,
    keys: ['taskId', 'attachmentId'],
    module: 'attachments',
  },
  {
    methods: ['GET'],
    pattern: /^\/tasks\/([^/]+)\/attachments\/?$/,
    keys: ['taskId'],
    module: 'attachments',
  },
  {
    methods: ['GET', 'PUT', 'DELETE'],
    pattern: /^\/tasks\/([^/]+)\/?$/,
    keys: ['taskId'],
    module: 'tasks',
  },
  {
    methods: ['GET'],
    pattern: /^\/dashboard\/summary\/?$/,
    keys: [],
    module: 'dashboard',
  },
  {
    methods: ['GET'],
    pattern: /^\/dashboard\/my-tasks\/?$/,
    keys: [],
    module: 'dashboard',
  },
]

/** @type {Map<string, { handler: Function }>} */
const handlerCache = new Map()

async function loadHandler(moduleName) {
  if (handlerCache.has(moduleName)) return handlerCache.get(moduleName)
  const file = join(DIST, moduleName, 'handler.js')
  if (!existsSync(file)) {
    throw new Error(
      `找不到 ${file}。请先执行: npm run local:build  （或 cd backend && npm run build）`,
    )
  }
  // 缓存破坏：每次请求重新加载可选 — 开发时用 query ?reload=1 或环境 FORCE_RELOAD
  const url =
    process.env.FORCE_RELOAD === '1'
      ? pathToFileURL(file).href + `?t=${Date.now()}`
      : pathToFileURL(file).href
  const mod = await import(url)
  if (typeof mod.handler !== 'function') {
    throw new Error(`${file} 未导出 handler`)
  }
  const entry = { handler: mod.handler }
  if (process.env.FORCE_RELOAD !== '1') handlerCache.set(moduleName, entry)
  return entry
}

function matchRoute(method, path) {
  // 去掉 stage 前缀 /local /prod
  let p = path.split('?')[0] || '/'
  if (p.startsWith('/local')) p = p.slice(6) || '/'
  if (p.startsWith('/prod')) p = p.slice(5) || '/'

  for (const route of ROUTES) {
    if (!route.methods.includes(method) && method !== 'OPTIONS') continue
    const m = p.match(route.pattern)
    if (!m) continue
    /** @type {Record<string, string>} */
    const pathParameters = {}
    route.keys.forEach((k, i) => {
      pathParameters[k] = decodeURIComponent(m[i + 1])
    })
    return { module: route.module, pathParameters, rawPath: p }
  }
  return null
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Correlation-Id, X-Dev-User-Sub, X-Dev-User-Email, X-Dev-User-Name',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} body
 * @param {ReturnType<typeof resolveLocalClaims>} claims
 * @param {{ module: string, pathParameters: Record<string, string>, rawPath: string }} matched
 */
function buildEvent(req, body, claims, matched) {
  const method = (req.method || 'GET').toUpperCase()
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  /** @type {Record<string, string>} */
  const headers = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : String(v)
  }

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: matched.rawPath,
    rawQueryString: url.search.startsWith('?') ? url.search.slice(1) : url.search,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    pathParameters: matched.pathParameters,
    requestContext: {
      accountId: 'local',
      apiId: 'local-api',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method,
        path: matched.rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress || '127.0.0.1',
        userAgent: headers['user-agent'] || 'local-api',
      },
      requestId: `local-${Date.now()}`,
      routeKey: '$default',
      stage: 'local',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
      authorizer: claims
        ? {
            jwt: {
              claims: {
                sub: claims.sub,
                email: claims.email || '',
                name: claims.name || '',
              },
            },
          }
        : undefined,
    },
    body: body || undefined,
    isBase64Encoded: false,
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase()
  const cors = corsHeaders()

  if (method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  try {
    const body = await readBody(req)
    const pathOnly = (req.url || '/').split('?')[0]
    const matched = matchRoute(method, pathOnly)

    if (!matched) {
      res.writeHead(404, cors)
      res.end(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: `本地路由未匹配: ${method} ${pathOnly}` },
        }),
      )
      return
    }

    const claims = resolveLocalClaims(req.headers)
    if (!claims && method !== 'OPTIONS') {
      res.writeHead(401, cors)
      res.end(
        JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message:
              '需要 Authorization: Bearer <Cognito ID Token>，或设置 LOCAL_DEV=1 并传 X-Dev-User-Sub',
          },
        }),
      )
      return
    }

    const { handler } = await loadHandler(matched.module)
    const event = buildEvent(req, body, claims, matched)
    const result = await handler(event)

    const statusCode =
      typeof result === 'string' ? 200 : result?.statusCode ?? 200
    const resultHeaders =
      typeof result === 'object' && result?.headers ? result.headers : {}
    const resultBody =
      typeof result === 'string' ? result : result?.body ?? JSON.stringify(result)

    res.writeHead(statusCode, { ...cors, ...resultHeaders })
    res.end(resultBody)
  } catch (err) {
    console.error('[local-api]', err)
    res.writeHead(500, cors)
    res.end(
      JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      }),
    )
  }
})

if (!existsSync(join(DIST, 'projects', 'handler.js'))) {
  console.error('错误: backend/dist 不存在或未编译。请先运行: npm run local:build')
  process.exit(1)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('')
  console.log('TaskVista 本地 Lambda API (Node，无 Docker)')
  console.log(`  URL:        http://127.0.0.1:${PORT}`)
  console.log(`  LOCAL_DEV:  ${process.env.LOCAL_DEV}`)
  console.log(`  REGION:     ${process.env.AWS_REGION}`)
  console.log(`  TABLES:     ${process.env.PROJECTS_TABLE}, ${process.env.TASKS_TABLE}, ...`)
  console.log('')
  console.log('前端请设置: VITE_API_BASE_URL=http://127.0.0.1:' + PORT)
  console.log('Mock 用户:  X-Dev-User-Sub / X-Dev-User-Email / X-Dev-User-Name')
  console.log('改代码后:   npm run local:build  然后重启本进程（或 FORCE_RELOAD=1）')
  console.log('')
})
