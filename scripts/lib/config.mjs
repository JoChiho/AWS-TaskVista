import { readFileSync, existsSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const PATHS = {
  root: ROOT,
  backend: resolve(ROOT, 'backend'),
  frontend: resolve(ROOT, 'frontend'),
  config: resolve(ROOT, 'deploy.config.json'),
  exampleConfig: resolve(ROOT, 'deploy.config.example.json'),
  deployTmp: resolve(ROOT, '.deploy-tmp'),
  lambdaZip: resolve(ROOT, '.deploy-tmp', 'lambda.zip'),
}

export const LAMBDAS = [
  { name: 'taskvista-projects', handler: 'projects/handler.handler' },
  { name: 'taskvista-tasks', handler: 'tasks/handler.handler' },
  { name: 'taskvista-comments', handler: 'comments/handler.handler' },
  { name: 'taskvista-attachments', handler: 'attachments/handler.handler' },
  { name: 'taskvista-dashboard', handler: 'dashboard/handler.handler' },
]

export const API_ROUTES = [
  { methods: ['GET', 'POST'], path: '/projects', lambda: 'taskvista-projects' },
  { methods: ['GET', 'PUT', 'DELETE'], path: '/projects/{projectId}', lambda: 'taskvista-projects' },
  { methods: ['POST'], path: '/projects/{projectId}/members', lambda: 'taskvista-projects' },
  {
    methods: ['DELETE'],
    path: '/projects/{projectId}/members/{memberKey}',
    lambda: 'taskvista-projects',
  },
  { methods: ['GET', 'POST'], path: '/projects/{projectId}/tasks', lambda: 'taskvista-tasks' },
  { methods: ['GET', 'PUT', 'DELETE'], path: '/tasks/{taskId}', lambda: 'taskvista-tasks' },
  { methods: ['PATCH'], path: '/tasks/{taskId}/status', lambda: 'taskvista-tasks' },
  { methods: ['GET', 'POST'], path: '/tasks/{taskId}/comments', lambda: 'taskvista-comments' },
  { methods: ['DELETE'], path: '/tasks/{taskId}/comments/{commentId}', lambda: 'taskvista-comments' },
  { methods: ['GET'], path: '/tasks/{taskId}/attachments', lambda: 'taskvista-attachments' },
  { methods: ['POST'], path: '/tasks/{taskId}/attachments/upload-url', lambda: 'taskvista-attachments' },
  {
    methods: ['GET'],
    path: '/tasks/{taskId}/attachments/{attachmentId}/download-url',
    lambda: 'taskvista-attachments',
  },
  { methods: ['DELETE'], path: '/tasks/{taskId}/attachments/{attachmentId}', lambda: 'taskvista-attachments' },
  { methods: ['GET'], path: '/dashboard/summary', lambda: 'taskvista-dashboard' },
  { methods: ['GET'], path: '/dashboard/my-tasks', lambda: 'taskvista-dashboard' },
  { methods: ['GET', 'PUT'], path: '/me', lambda: 'taskvista-dashboard' },
  { methods: ['POST'], path: '/users/display-names', lambda: 'taskvista-dashboard' },
]

/** deploy.config.json を読み込む */
export function loadConfig() {
  if (!existsSync(PATHS.config)) {
    throw new Error(
      `deploy.config.json が見つかりません。deploy.config.example.json をコピーして値を設定してください:\n` +
        `  copy deploy.config.example.json deploy.config.json`,
    )
  }
  return JSON.parse(readFileSync(PATHS.config, 'utf8'))
}

/** API Gateway ID を設定ファイルに保存する */
export function saveApiGatewayId(apiId) {
  const config = loadConfig()
  config.apiGatewayId = apiId
  writeFileSync(PATHS.config, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

export function getApiBaseUrl(config) {
  if (!config.apiGatewayId) {
    throw new Error('apiGatewayId が未設定です。--bootstrap を実行するか deploy.config.json に記入してください。')
  }
  const stage = config.apiGatewayStage || 'prod'
  return `https://${config.apiGatewayId}.execute-api.${config.region}.amazonaws.com/${stage}`
}