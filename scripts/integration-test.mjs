/**
 * TaskVista API 統合テスト
 * 使用方法: node scripts/integration-test.mjs
 * 環境変数: TEST_USER, TEST_PASSWORD (省略時は deploy.config.json の Cognito 設定を使用)
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { awsJson } from './lib/shell.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(readFileSync(resolve(ROOT, 'deploy.config.json'), 'utf8'))

const API_BASE = `https://${config.apiGatewayId}.execute-api.${config.region}.amazonaws.com/prod`
const TEST_USER = process.env.TEST_USER ?? 'xuzhifu@findix.co.jp'
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'TaskVista2026!'

const results = []
let passed = 0
let failed = 0

function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (ok) passed++
  else failed++
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function getAccessToken() {
  try {
    const result = awsJson([
      'cognito-idp',
      'admin-initiate-auth',
      '--user-pool-id',
      config.cognito.userPoolId,
      '--client-id',
      config.cognito.clientId,
      '--auth-flow',
      'ADMIN_NO_SRP_AUTH',
      '--auth-parameters',
      `USERNAME=${TEST_USER},PASSWORD=${TEST_PASSWORD}`,
      '--region',
      config.region,
    ])
    return result.AuthenticationResult.AccessToken
  } catch (error) {
    console.error('認証失敗。TEST_USER / TEST_PASSWORD を確認してください。')
    throw error
  }
}

async function api(method, path, token, body) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
  const options = { method, headers }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${API_BASE}${path}`, options)
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, json }
}

async function main() {
  console.log(`\nTaskVista API 統合テスト`)
  console.log(`API: ${API_BASE}`)
  console.log(`User: ${TEST_USER}\n`)

  const token = await getAccessToken()
  record('認証 (Cognito JWT 取得)', !!token)

  // ── Projects ──
  let projectId
  let projectName = `IntegrationTest-${Date.now()}`

  const listProjects = await api('GET', '/projects', token)
  record('GET /projects', listProjects.status === 200, `status=${listProjects.status}`)

  const createProject = await api('POST', '/projects', token, {
    name: projectName,
    description: '統合テスト用プロジェクト',
  })
  record(
    'POST /projects (作成)',
    createProject.status === 201,
    `status=${createProject.status}`,
  )
  projectId = createProject.json?.data?.projectId

  if (!projectId) {
    console.error('\nプロジェクト作成に失敗したため、以降のテストをスキップします。')
    printSummary()
    process.exit(1)
  }

  const getProject = await api('GET', `/projects/${projectId}`, token)
  record('GET /projects/{projectId}', getProject.status === 200, `status=${getProject.status}`)

  const updateProject = await api('PUT', `/projects/${projectId}`, token, {
    name: `${projectName}-updated`,
    description: '更新済み',
  })
  record('PUT /projects/{projectId}', updateProject.status === 200, `status=${updateProject.status}`)

  // ── Tasks ──
  let taskId

  const listTasks = await api('GET', `/projects/${projectId}/tasks`, token)
  record(
    'GET /projects/{projectId}/tasks',
    listTasks.status === 200,
    `status=${listTasks.status}`,
  )

  const createTask = await api('POST', `/projects/${projectId}/tasks`, token, {
    title: '統合テストタスク',
    description: 'テスト説明',
    status: '未着手',
    priority: 'medium',
    assigneeId: '047894e8-4081-7078-59bb-06f86cc1de53',
    dueDate: '2026-12-31',
  })
  record(
    'POST /projects/{projectId}/tasks (作成)',
    createTask.status === 201,
    `status=${createTask.status}`,
  )
  taskId = createTask.json?.data?.taskId

  if (!taskId) {
    console.error('\nタスク作成に失敗したため、以降のテストをスキップします。')
    await cleanup(token, projectId, null)
    printSummary()
    process.exit(1)
  }

  const getTask = await api('GET', `/tasks/${taskId}`, token)
  record('GET /tasks/{taskId}', getTask.status === 200, `status=${getTask.status}`)

  const updateTask = await api('PUT', `/tasks/${taskId}`, token, {
    title: '統合テストタスク（更新）',
    description: '更新済み',
    requirement: 'テスト要望',
  })
  record('PUT /tasks/{taskId}', updateTask.status === 200, `status=${updateTask.status}`)

  const patchStatus = await api('PATCH', `/tasks/${taskId}/status`, token, {
    status: '進行中',
  })
  record(
    'PATCH /tasks/{taskId}/status (かんばん)',
    patchStatus.status === 200,
    `status=${patchStatus.status}`,
  )

  // ── Comments ──
  let commentId

  const listComments = await api('GET', `/tasks/${taskId}/comments`, token)
  record(
    'GET /tasks/{taskId}/comments',
    listComments.status === 200,
    `status=${listComments.status}`,
  )

  const createComment = await api('POST', `/tasks/${taskId}/comments`, token, {
    content: '統合テストコメント',
  })
  record(
    'POST /tasks/{taskId}/comments (作成)',
    createComment.status === 201,
    `status=${createComment.status}`,
  )
  commentId = createComment.json?.data?.commentId

  if (commentId) {
    const deleteComment = await api('DELETE', `/tasks/${taskId}/comments/${commentId}`, token)
    record(
      'DELETE /tasks/{taskId}/comments/{commentId}',
      deleteComment.status === 200,
      `status=${deleteComment.status}`,
    )
  } else {
    record('DELETE /tasks/{taskId}/comments/{commentId}', false, 'commentId 未取得')
  }

  // ── Attachments ──
  const listAttachments = await api('GET', `/tasks/${taskId}/attachments`, token)
  record(
    'GET /tasks/{taskId}/attachments',
    listAttachments.status === 200,
    `status=${listAttachments.status}`,
  )

  const uploadUrl = await api('POST', `/tasks/${taskId}/attachments/upload-url`, token, {
    filename: 'test.txt',
    contentType: 'text/plain',
    sizeBytes: 12,
  })
  record(
    'POST /tasks/{taskId}/attachments/upload-url',
    uploadUrl.status === 200,
    `status=${uploadUrl.status}`,
  )

  const attachmentId = uploadUrl.json?.data?.attachmentId
  if (attachmentId) {
    const downloadUrl = await api(
      'GET',
      `/tasks/${taskId}/attachments/${attachmentId}/download-url`,
      token,
    )
    record(
      'GET /tasks/{taskId}/attachments/{id}/download-url',
      downloadUrl.status === 200,
      `status=${downloadUrl.status}`,
    )

    const deleteAttachment = await api(
      'DELETE',
      `/tasks/${taskId}/attachments/${attachmentId}`,
      token,
    )
    record(
      'DELETE /tasks/{taskId}/attachments/{id}',
      deleteAttachment.status === 200,
      `status=${deleteAttachment.status}`,
    )
  } else {
    record('GET/DELETE attachments/{id}', false, 'attachmentId 未取得')
  }

  // ── Dashboard ──
  const summary = await api('GET', '/dashboard/summary', token)
  record('GET /dashboard/summary', summary.status === 200, `status=${summary.status}`)

  const myTasks = await api('GET', '/dashboard/my-tasks', token)
  record('GET /dashboard/my-tasks', myTasks.status === 200, `status=${myTasks.status}`)

  // ── Cleanup ──
  await cleanup(token, projectId, taskId)

  printSummary()
  process.exit(failed > 0 ? 1 : 0)
}

async function cleanup(token, projectId, taskId) {
  if (taskId) {
    const deleteTask = await api('DELETE', `/tasks/${taskId}`, token)
    record('DELETE /tasks/{taskId}', deleteTask.status === 200, `status=${deleteTask.status}`)
  }

  const deleteProject = await api('DELETE', `/projects/${projectId}`, token)
  record(
    'DELETE /projects/{projectId}',
    deleteProject.status === 200,
    `status=${deleteProject.status}`,
  )
}

function printSummary() {
  console.log(`\n${'─'.repeat(40)}`)
  console.log(`結果: ${passed} 成功 / ${failed} 失敗 / ${results.length} 合計`)
  if (failed > 0) {
    console.log('\n失敗したテスト:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`  - ${r.name}: ${r.detail}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})