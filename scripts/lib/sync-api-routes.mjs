/**
 * 既存 HTTP API に、API_ROUTES 定義にあって未登録のルートだけを追加する。
 *
 * 本番では deploy:backend が Lambda コードだけ更新し、API Gateway ルートは
 * 初回 bootstrap 時にしか作られないため、新エンドポイント追加時に 404 になる。
 * （ブラウザでは CORS エラーに見えることが多い）
 */
import { aws, awsJson } from './shell.mjs'
import { API_ROUTES, LAMBDAS } from './config.mjs'

/**
 * Lambda 名 → IntegrationId を既存ルート / 統合一覧から解決する
 */
function resolveIntegrations(apiId, region) {
  const integrations = awsJson([
    'apigatewayv2',
    'get-integrations',
    '--api-id',
    apiId,
    '--region',
    region,
  ])
  const items = integrations?.Items ?? []

  /** @type {Map<string, string>} lambda function name → integration id */
  const byLambdaName = new Map()

  for (const integ of items) {
    const uri = integ.IntegrationUri || ''
    // arn:aws:lambda:region:acct:function:taskvista-dashboard
    const m = uri.match(/function:([a-zA-Z0-9-_]+)/)
    if (m) {
      byLambdaName.set(m[1], integ.IntegrationId)
    }
  }

  // 統合が無い場合はルートの target から拾えないので、既存ルート経由は省略
  return byLambdaName
}

function listRouteKeys(apiId, region) {
  const keys = new Set()
  let nextToken
  do {
    const args = [
      'apigatewayv2',
      'get-routes',
      '--api-id',
      apiId,
      '--region',
      region,
    ]
    if (nextToken) {
      args.push('--next-token', nextToken)
    }
    const page = awsJson(args)
    for (const r of page?.Items ?? []) {
      if (r.RouteKey) keys.add(r.RouteKey)
    }
    nextToken = page?.NextToken
  } while (nextToken)
  return keys
}

function getJwtAuthorizerId(apiId, region) {
  const res = awsJson([
    'apigatewayv2',
    'get-authorizers',
    '--api-id',
    apiId,
    '--region',
    region,
  ])
  const items = res?.Items ?? []
  const jwt = items.find((a) => a.AuthorizerType === 'JWT') || items[0]
  if (!jwt?.AuthorizerId) {
    throw new Error(
      `API ${apiId} に JWT Authorizer が見つかりません。コンソールで確認してください。`,
    )
  }
  return jwt.AuthorizerId
}

/**
 * 不足している API ルートを追加する
 * @returns {{ added: string[], skipped: string[] }}
 */
export function syncApiRoutes(config, dryRun = false) {
  const apiId = config.apiGatewayId
  if (!apiId) {
    throw new Error(
      'deploy.config.json に apiGatewayId がありません。先に bootstrap するか ID を記入してください。',
    )
  }

  console.log('\n=== API Gateway ルート同期 ===')
  console.log(`API: ${apiId} (${config.region})`)

  if (dryRun) {
    console.log('[dry-run] ルート差分チェックをスキップ（認証なし）')
    return { added: [], skipped: [] }
  }

  const existing = listRouteKeys(apiId, config.region)
  const byLambda = resolveIntegrations(apiId, config.region)
  const authorizerId = getJwtAuthorizerId(apiId, config.region)

  // 既知名の Lambda が統合に無い場合は、同名の既存ルートから Integration を探す
  if (byLambda.size === 0) {
    console.log('統合一覧から Lambda を特定できませんでした。ルートの target を走査します...')
    // fallback: get each route detail is heavy; try create-integration if needed
  }

  const knownLambdaNames = new Set(LAMBDAS.map((f) => f.name))
  for (const name of knownLambdaNames) {
    if (!byLambda.has(name)) {
      // 統合が無い → 新規作成
      const lambdaArn = `arn:aws:lambda:${config.region}:${config.accountId}:function:${name}`
      console.log(`統合を作成: ${name}`)
      const integration = awsJson([
        'apigatewayv2',
        'create-integration',
        '--api-id',
        apiId,
        '--integration-type',
        'AWS_PROXY',
        '--integration-uri',
        lambdaArn,
        '--payload-format-version',
        '2.0',
        '--region',
        config.region,
      ])
      byLambda.set(name, integration.IntegrationId)

      try {
        aws([
          'lambda',
          'add-permission',
          '--function-name',
          name,
          '--statement-id',
          `apigateway-${apiId}-sync`,
          '--action',
          'lambda:InvokeFunction',
          '--principal',
          'apigateway.amazonaws.com',
          '--source-arn',
          `arn:aws:execute-api:${config.region}:${config.accountId}:${apiId}/*`,
          '--region',
          config.region,
        ])
      } catch {
        console.log(`  (権限は既に付与済み: ${name})`)
      }
    }
  }

  const added = []
  const skipped = []

  for (const route of API_ROUTES) {
    const integrationId = byLambda.get(route.lambda)
    if (!integrationId) {
      console.warn(`⚠ 統合が見つからないためスキップ: ${route.lambda}`)
      continue
    }

    for (const method of route.methods) {
      const routeKey = `${method} ${route.path}`
      if (existing.has(routeKey)) {
        skipped.push(routeKey)
        continue
      }

      console.log(`追加: ${routeKey} → ${route.lambda}`)
      try {
        aws([
          'apigatewayv2',
          'create-route',
          '--api-id',
          apiId,
          '--route-key',
          routeKey,
          '--target',
          `integrations/${integrationId}`,
          '--authorization-type',
          'JWT',
          '--authorizer-id',
          authorizerId,
          '--region',
          config.region,
        ])
        added.push(routeKey)
        existing.add(routeKey)
      } catch (error) {
        const msg = error.message ?? ''
        if (msg.includes('ConflictException') || msg.includes('AlreadyExists')) {
          console.log(`  スキップ（既存）: ${routeKey}`)
          skipped.push(routeKey)
        } else {
          throw error
        }
      }
    }
  }

  console.log(`ルート同期完了: 追加 ${added.length} / 既存 ${skipped.length}`)
  if (added.length) {
    console.log('  追加:', added.join(', '))
  }

  return { added, skipped }
}
