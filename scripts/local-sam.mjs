#!/usr/bin/env node
/**
 * 使用 SAM Local 启动 API（需要 Docker Desktop + SAM CLI）
 * 用法: npm run local:sam
 */
import { spawnSync, spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function hasCmd(cmd) {
  const r = spawnSync(cmd, ['--version'], { shell: true, encoding: 'utf8' })
  return r.status === 0
}

if (!hasCmd('sam')) {
  console.error('未检测到 AWS SAM CLI。')
  console.error('安装: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html')
  console.error('未安装前请使用: npm run local:api')
  process.exit(1)
}

if (!hasCmd('docker')) {
  console.error('未检测到 Docker。sam local 需要 Docker Desktop 运行中。')
  console.error('未安装前请使用: npm run local:api')
  process.exit(1)
}

// 先编译
const build = spawnSync('node', [resolve(ROOT, 'scripts/local-build.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
})
if (build.status !== 0) process.exit(build.status ?? 1)

const envFile = resolve(ROOT, 'env/local.json')
if (!existsSync(envFile)) {
  console.error('缺少 env/local.json')
  process.exit(1)
}

console.log('启动 sam local start-api :3001 ...')
const child = spawn(
  'sam',
  [
    'local',
    'start-api',
    '--port',
    '3001',
    '--env-vars',
    'env/local.json',
    '--warm-containers',
    'EAGER',
  ],
  { cwd: ROOT, stdio: 'inherit', shell: true },
)

child.on('exit', (code) => process.exit(code ?? 0))
