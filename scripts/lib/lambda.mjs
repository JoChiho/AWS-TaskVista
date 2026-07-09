import { cpSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { run, awsJson } from './shell.mjs'
import { PATHS, LAMBDAS } from './config.mjs'

function sleep(ms) {
  const buffer = new SharedArrayBuffer(4)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, ms)
}

/** Lambda の更新完了を待つ */
function waitForLambdaReady(functionName, region) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = awsJson(['lambda', 'get-function', '--function-name', functionName, '--region', region])
    const { State, LastUpdateStatus } = result.Configuration
    if (State === 'Active' && LastUpdateStatus === 'Successful') {
      return
    }
    sleep(2000)
  }
  throw new Error(`Lambda ${functionName} の更新がタイムアウトしました`)
}

/** Lambda 用 zip パッケージを作成する */
export function packageLambda(dryRun = false) {
  const packageDir = resolve(PATHS.deployTmp, 'lambda-package')

  if (!dryRun) {
    rmSync(PATHS.deployTmp, { recursive: true, force: true })
    mkdirSync(packageDir, { recursive: true })

    cpSync(resolve(PATHS.backend, 'dist'), packageDir, { recursive: true })
    cpSync(resolve(PATHS.backend, 'node_modules'), resolve(packageDir, 'node_modules'), {
      recursive: true,
    })
    // Lambda 上で ESM (import) を有効にする
    writeFileSync(
      resolve(packageDir, 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2) + '\n',
      'utf8',
    )

    if (process.platform === 'win32') {
      run(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Compress-Archive -Path '${packageDir}\\*' -DestinationPath '${PATHS.lambdaZip}' -Force`,
        ],
        { dryRun },
      )
    } else {
      run('bash', ['-lc', `cd '${packageDir}' && zip -r '${PATHS.lambdaZip}' .`], { dryRun })
    }
  } else {
    console.log(`[dry-run] Lambda zip を ${PATHS.lambdaZip} に作成`)
  }
}

/** Lambda 関数が存在するか確認する */
export function lambdaExists(functionName, region, dryRun = false) {
  if (dryRun) return false
  try {
    run('aws', ['lambda', 'get-function', '--function-name', functionName, '--region', region], {
      silent: true,
    })
    return true
  } catch {
    return false
  }
}

/** Lambda 関数を作成する */
export function createLambda(fn, config, dryRun = false) {
  const envPairs = Object.entries(config.lambdaEnvironment).map(([k, v]) => `${k}=${v}`)

  run(
    'aws',
    [
      'lambda',
      'create-function',
      '--function-name',
      fn.name,
      '--runtime',
      'nodejs20.x',
      '--role',
      config.lambdaRoleArn,
      '--handler',
      fn.handler,
      '--zip-file',
      `fileb://${PATHS.lambdaZip}`,
      '--timeout',
      '30',
      '--memory-size',
      '256',
      '--environment',
      `Variables={${envPairs.join(',')}}`,
      '--region',
      config.region,
    ],
    { dryRun },
  )
}

/** Lambda 関数コードを更新する */
export function updateLambdaCode(fn, config, dryRun = false) {
  run(
    'aws',
    [
      'lambda',
      'update-function-code',
      '--function-name',
      fn.name,
      '--zip-file',
      `fileb://${PATHS.lambdaZip}`,
      '--region',
      config.region,
    ],
    { dryRun },
  )

  if (!dryRun) {
    waitForLambdaReady(fn.name, config.region)
  }

  const envPairs = Object.entries(config.lambdaEnvironment).map(([k, v]) => `${k}=${v}`)
  run(
    'aws',
    [
      'lambda',
      'update-function-configuration',
      '--function-name',
      fn.name,
      '--handler',
      fn.handler,
      '--runtime',
      'nodejs20.x',
      '--timeout',
      '30',
      '--memory-size',
      '256',
      '--environment',
      `Variables={${envPairs.join(',')}}`,
      '--region',
      config.region,
    ],
    { dryRun },
  )

  if (!dryRun) {
    waitForLambdaReady(fn.name, config.region)
  }
}

/** 全 Lambda をデプロイする */
export function deployLambdas(config, options = {}) {
  const { dryRun = false, createIfMissing = false } = options

  console.log('\n=== Lambda デプロイ ===')

  run('npm', ['test'], { cwd: PATHS.backend, dryRun })
  run('npm', ['run', 'build'], { cwd: PATHS.backend, dryRun })
  packageLambda(dryRun)

  for (const fn of LAMBDAS) {
    if (dryRun) {
      console.log(`[dry-run] デプロイ: ${fn.name} (${fn.handler})`)
      continue
    }

    const exists = lambdaExists(fn.name, config.region)
    if (exists) {
      console.log(`更新: ${fn.name}`)
      updateLambdaCode(fn, config, dryRun)
    } else if (createIfMissing) {
      console.log(`新規作成: ${fn.name}`)
      createLambda(fn, config, dryRun)
    } else {
      throw new Error(
        `Lambda 関数 ${fn.name} が存在しません。初回は --bootstrap オプションを付けて実行してください。`,
      )
    }
  }

  console.log('Lambda デプロイ完了')
}