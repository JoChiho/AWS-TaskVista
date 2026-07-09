import { run } from './shell.mjs'
import { PATHS } from './config.mjs'

/** フロントエンドをビルドして S3 にデプロイする */
export function deployFrontend(config, apiBaseUrl, dryRun = false) {
  console.log('\n=== フロントエンド デプロイ ===')

  if (
    !dryRun &&
    (!config.cloudFrontDomain || config.cloudFrontDomain.includes('your-cloudfront'))
  ) {
    throw new Error('deploy.config.json の cloudFrontDomain を設定してください。')
  }

  const redirectUri = `${config.cloudFrontDomain.replace(/\/$/, '')}/callback`
  const env = {
    VITE_API_BASE_URL: apiBaseUrl,
    VITE_COGNITO_USER_POOL_ID: config.cognito.userPoolId,
    VITE_COGNITO_CLIENT_ID: config.cognito.clientId,
    VITE_COGNITO_DOMAIN: config.cognito.domain,
    VITE_COGNITO_REDIRECT_URI: redirectUri,
  }

  run('npm', ['run', 'build'], { cwd: PATHS.frontend, env, dryRun })

  run(
    'aws',
    [
      's3',
      'sync',
      `${PATHS.frontend}/dist`,
      `s3://${config.frontendBucket}`,
      '--delete',
      '--region',
      config.region,
    ],
    { dryRun },
  )

  if (config.cloudFrontDistributionId) {
    run(
      'aws',
      [
        'cloudfront',
        'create-invalidation',
        '--distribution-id',
        config.cloudFrontDistributionId,
        '--paths',
        '/*',
      ],
      { dryRun },
    )
  } else {
    console.log('cloudFrontDistributionId 未設定のためキャッシュ無効化をスキップしました。')
  }

  console.log('フロントエンド デプロイ完了')
}