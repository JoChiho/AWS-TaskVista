import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import type { EnvironmentConfig } from './config'
import { AuthStack } from './stacks/auth-stack'
import { StorageStack } from './stacks/storage-stack'
import { BackendStack } from './stacks/backend-stack'
import { FrontendStack } from './stacks/frontend-stack'

export interface TaskVistaStackProps extends cdk.StackProps {
  config: EnvironmentConfig
}

/**
 * メインスタック: Auth → Storage → Backend / Frontend を NestedStack で合成する。
 *
 * 依存関係:
 *   Auth, Storage  … 独立
 *   Backend        … Auth (JWT) + Storage (DDB/S3)
 *   Frontend       … Storage (frontend bucket)
 *
 * デプロイ後、CloudFront URL を Cognito コールバックに追加する場合:
 *   1. 初回 deploy で URL を取得
 *   2. config.additionalCallbackUrls に追加して再 deploy
 *   または Cognito コンソールで手動追加
 */
export class TaskVistaStack extends cdk.Stack {
  public readonly auth: AuthStack
  public readonly storage: StorageStack
  public readonly backend: BackendStack
  public readonly frontend: FrontendStack

  constructor(scope: Construct, id: string, props: TaskVistaStackProps) {
    super(scope, id, props)

    const { config } = props

    cdk.Tags.of(this).add('Project', 'TaskVista')
    cdk.Tags.of(this).add('Environment', config.envName)
    cdk.Tags.of(this).add('ManagedBy', 'CDK')

    // 1. Auth（Cognito）
    this.auth = new AuthStack(this, 'Auth', { config })

    // 2. Storage（DynamoDB + 添付 S3）
    this.storage = new StorageStack(this, 'Storage', { config })

    // 3. Frontend（SPA 用 S3 + CloudFront OAC ※バケットは同スタックで循環参照回避）
    this.frontend = new FrontendStack(this, 'Frontend', { config })

    // 4. Backend（Lambda + HTTP API + Cognito Authorizer）
    this.backend = new BackendStack(this, 'Backend', {
      config,
      userPool: this.auth.userPool,
      userPoolClient: this.auth.userPoolClient,
      projectsTable: this.storage.projectsTable,
      tasksTable: this.storage.tasksTable,
      commentsTable: this.storage.commentsTable,
      usersTable: this.storage.usersTable,
      attachmentsBucket: this.storage.attachmentsBucket,
      corsAllowOrigins: [
        this.frontend.appUrl,
        `https://${this.frontend.distributionDomainName}`,
      ],
    })

    // ── 親スタック集約 Outputs（コンソールで探しやすくする） ──
    new cdk.CfnOutput(this, 'Environment', {
      value: config.envName,
    })
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.auth.userPool.userPoolId,
      description: 'VITE_COGNITO_USER_POOL_ID',
    })
    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.auth.userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
    })
    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: this.auth.cognitoDomainUrl,
      description: 'VITE_COGNITO_DOMAIN',
    })
    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.auth.identityPool.ref,
    })
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.backend.apiUrl,
      description: 'VITE_API_BASE_URL',
    })
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.frontend.appUrl,
      description: 'Frontend URL / Cognito callback base',
    })
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.frontend.distribution.distributionId,
    })
    new cdk.CfnOutput(this, 'FrontendBucketName', {
      value: this.frontend.frontendBucket.bucketName,
    })
    new cdk.CfnOutput(this, 'AttachmentsBucketName', {
      value: this.storage.attachmentsBucket.bucketName,
    })
    new cdk.CfnOutput(this, 'ProjectsTableName', {
      value: this.storage.projectsTable.tableName,
    })
    new cdk.CfnOutput(this, 'TasksTableName', {
      value: this.storage.tasksTable.tableName,
    })
    new cdk.CfnOutput(this, 'CommentsTableName', {
      value: this.storage.commentsTable.tableName,
    })
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.storage.usersTable.tableName,
    })
    new cdk.CfnOutput(this, 'FrontendEnvHint', {
      value: [
        `VITE_API_BASE_URL=${this.backend.apiUrl}`,
        `VITE_COGNITO_USER_POOL_ID=${this.auth.userPool.userPoolId}`,
        `VITE_COGNITO_CLIENT_ID=${this.auth.userPoolClient.userPoolClientId}`,
        `VITE_COGNITO_DOMAIN=${this.auth.cognitoDomainUrl}`,
        `VITE_COGNITO_REDIRECT_URI=${this.frontend.appUrl}/callback`,
      ].join(' '),
      description: 'Copy into frontend build env / deploy.config.json',
    })
  }
}
