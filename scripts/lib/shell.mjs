import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { platform } from 'os'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** AWS CLI のパスを解決する（venv 内の pip 版を優先） */
function resolveAwsCommand() {
  if (platform() !== 'win32') return 'aws'

  const venvAws = resolve(ROOT, 'venv', 'Scripts', 'aws.cmd')
  if (existsSync(venvAws)) return `"${venvAws}"`

  const defaultAws = 'C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe'
  if (existsSync(defaultAws)) return `"${defaultAws}"`

  return 'aws'
}

const AWS_COMMAND = resolveAwsCommand()

/** コマンドを実行し、失敗時はエラーを投げる */
export function run(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const display = options.display ?? `${command} ${args.join(' ')}`

  if (options.dryRun) {
    console.log(`[dry-run] ${display}`)
    return { stdout: '', stderr: '', status: 0 }
  }

  console.log(`> ${display}`)
  const result = spawnSync(command, args, {
    cwd,
    stdio: options.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: platform() === 'win32',
    env: { ...process.env, ...options.env },
  })

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim()
    throw new Error(`コマンドが失敗しました (${result.status}): ${display}${detail ? `\n${detail}` : ''}`)
  }

  return result
}

/** AWS CLI を実行して JSON を返す */
export function awsJson(args, options = {}) {
  const result = runAws(args, { ...options, silent: true })
  const output = result.stdout?.trim()
  return output ? JSON.parse(output) : null
}

/** AWS CLI を実行（出力なし） */
export function aws(args, options = {}) {
  runAws(args, options)
}

function runAws(args, options = {}) {
  if (AWS_COMMAND.includes('.cmd') || AWS_COMMAND.includes('.exe')) {
    const fullCommand = `${AWS_COMMAND} ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
    return run(fullCommand, [], { ...options, display: `aws ${args.join(' ')}` })
  }
  return run('aws', args, options)
}

/** AWS 認証情報が設定されているか確認する */
export function checkAwsCredentials() {
  try {
    runAws(['sts', 'get-caller-identity'], { silent: true })
    return true
  } catch {
    return false
  }
}