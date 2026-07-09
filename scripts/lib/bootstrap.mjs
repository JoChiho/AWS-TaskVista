import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { aws, awsJson } from './shell.mjs'
import { API_ROUTES, LAMBDAS, PATHS, getApiBaseUrl, saveApiGatewayId } from './config.mjs'
import { deployLambdas } from './lambda.mjs'

function writeCorsConfigFile() {
  const corsPath = resolve(PATHS.deployTmp, 'cors.json')
  mkdirSync(PATHS.deployTmp, { recursive: true })
  writeFileSync(
    corsPath,
    JSON.stringify({
      AllowOrigins: ['*'],
      AllowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      AllowHeaders: ['content-type', 'authorization', 'x-correlation-id'],
    }),
    'utf8',
  )
  return corsPath
}

/** API Gateway と Lambda の初回セットアップを行う */
export async function bootstrapInfra(config, dryRun = false) {
  console.log('\n=== 初回インフラセットアップ (bootstrap) ===')

  deployLambdas(config, { dryRun, createIfMissing: true })

  if (dryRun) {
    console.log('[dry-run] API Gateway セットアップをスキップ')
    return config.apiGatewayId || '<API_ID>'
  }

  let apiId = config.apiGatewayId

  if (!apiId) {
    console.log('HTTP API を作成中...')
    const corsPath = writeCorsConfigFile()
    const api = awsJson([
      'apigatewayv2',
      'create-api',
      '--name',
      'taskvista-api',
      '--protocol-type',
      'HTTP',
      '--cors-configuration',
      `file://${corsPath.replace(/\\/g, '/')}`,
      '--region',
      config.region,
    ])
    apiId = api.ApiId
    saveApiGatewayId(apiId)
    console.log(`API 作成完了: ${apiId}`)
  }

  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.cognito.userPoolId}`

  console.log('JWT Authorizer を作成中...')
  const authorizer = awsJson([
    'apigatewayv2',
    'create-authorizer',
    '--api-id',
    apiId,
    '--authorizer-type',
    'JWT',
    '--identity-source',
    '$request.header.Authorization',
    '--name',
    'cognito-authorizer',
    '--jwt-configuration',
    `Audience=${config.cognito.clientId},Issuer=${issuer}`,
    '--region',
    config.region,
  ])
  const authorizerId = authorizer.AuthorizerId

  const integrationIds = {}
  for (const fn of LAMBDAS) {
    const lambdaArn = `arn:aws:lambda:${config.region}:${config.accountId}:function:${fn.name}`
    console.log(`統合を作成: ${fn.name}`)
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
    integrationIds[fn.name] = integration.IntegrationId

    try {
      aws([
        'lambda',
        'add-permission',
        '--function-name',
        fn.name,
        '--statement-id',
        `apigateway-${apiId}`,
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
      console.log(`  (権限は既に付与済み: ${fn.name})`)
    }
  }

  console.log('ルートを作成中...')
  for (const route of API_ROUTES) {
    const integrationId = integrationIds[route.lambda]
    for (const method of route.methods) {
      try {
        aws([
          'apigatewayv2',
          'create-route',
          '--api-id',
          apiId,
          '--route-key',
          `${method} ${route.path}`,
          '--target',
          `integrations/${integrationId}`,
          '--authorization-type',
          'JWT',
          '--authorizer-id',
          authorizerId,
          '--region',
          config.region,
        ])
      } catch (error) {
        const msg = error.message ?? ''
        if (msg.includes('ConflictException') || msg.includes('AlreadyExists')) {
          console.log(`  スキップ（既存）: ${method} ${route.path}`)
        } else {
          throw error
        }
      }
    }
  }

  try {
    aws([
      'apigatewayv2',
      'create-stage',
      '--api-id',
      apiId,
      '--stage-name',
      'prod',
      '--auto-deploy',
      '--region',
      config.region,
    ])
  } catch {
    console.log('Stage prod は既に存在します')
  }

  const apiUrl = getApiBaseUrl({ ...config, apiGatewayId: apiId })
  console.log(`\nBootstrap 完了。API URL: ${apiUrl}`)
  console.log('deploy.config.json に apiGatewayId が保存されました。')

  return apiId
}