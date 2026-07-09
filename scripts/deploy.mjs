#!/usr/bin/env node
/**
 * TaskVista ワンコマンドデプロイスクリプト
 *
 * 使い方:
 *   node scripts/deploy.mjs              # バックエンド + フロントエンド
 *   node scripts/deploy.mjs --backend    # Lambda のみ
 *   node scripts/deploy.mjs --frontend   # フロントエンドのみ
 *   node scripts/deploy.mjs --bootstrap  # 初回: Lambda 作成 + API Gateway 構築
 *   node scripts/deploy.mjs --dry-run    # 実行内容の確認のみ
 */
import { loadConfig, getApiBaseUrl } from './lib/config.mjs'
import { run, checkAwsCredentials } from './lib/shell.mjs'
import { deployLambdas } from './lib/lambda.mjs'
import { deployFrontend } from './lib/frontend.mjs'
import { bootstrapInfra } from './lib/bootstrap.mjs'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const bootstrap = args.includes('--bootstrap')
const backendOnly = args.includes('--backend')
const frontendOnly = args.includes('--frontend')
const deployAll = !backendOnly && !frontendOnly

function printUsage() {
  console.log(`
TaskVista デプロイ

  npm run deploy              全てデプロイ
  npm run deploy:backend      Lambda のみ
  npm run deploy:frontend     フロントエンドのみ
  npm run deploy:bootstrap    初回セットアップ（Lambda 作成 + API Gateway）
  npm run deploy -- --dry-run 確認のみ（AWS 操作なし）
`)
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printUsage()
    return
  }

  console.log('TaskVista 自動デプロイを開始します...')
  if (dryRun) console.log('*** DRY-RUN モード（AWS への変更なし）***\n')

  if (!dryRun) {
    if (!checkAwsCredentials()) {
      throw new Error(
        'AWS 認証情報が設定されていません。以下のいずれかを実行してください:\n' +
          '  1. aws configure  （Access Key / Secret Key / region: us-east-1）\n' +
          '  2. 環境変数 AWS_ACCESS_KEY_ID と AWS_SECRET_ACCESS_KEY を設定\n' +
          '  3. AWS SSO: aws configure sso',
      )
    }
    console.log('AWS 認証: OK')
  }

  const config = loadConfig()

  let apiBaseUrl
  if (bootstrap) {
    await bootstrapInfra(config, dryRun)
    apiBaseUrl = getApiBaseUrl(loadConfig())
    if (!frontendOnly) {
      // bootstrap は backend も含む
    }
    if (deployAll || frontendOnly) {
      deployFrontend(config, apiBaseUrl, dryRun)
    }
    return
  }

  apiBaseUrl = config.apiGatewayId
    ? getApiBaseUrl(config)
    : dryRun
      ? `https://dry-run.execute-api.${config.region}.amazonaws.com`
      : getApiBaseUrl(config)

  if (deployAll || backendOnly) {
    deployLambdas(config, { dryRun, createIfMissing: false })
  }

  if (deployAll || frontendOnly) {
    deployFrontend(config, apiBaseUrl, dryRun)
  }

  console.log('\nデプロイ完了!')
  console.log(`API:        ${apiBaseUrl}`)
  console.log(`フロントエンド: ${config.cloudFrontDomain}`)
}

main().catch((error) => {
  console.error('\nデプロイ失敗:', error.message)
  process.exit(1)
})