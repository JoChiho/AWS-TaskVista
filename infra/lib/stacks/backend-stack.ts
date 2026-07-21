import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as apigwAuthorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import {
  NodejsFunction,
  type NodejsFunctionProps,
  OutputFormat,
} from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import { Construct } from 'constructs'
import type { EnvironmentConfig } from '../config'

export interface BackendStackProps extends cdk.NestedStackProps {
  config: EnvironmentConfig
  userPool: cognito.IUserPool
  userPoolClient: cognito.IUserPoolClient
  projectsTable: dynamodb.ITable
  tasksTable: dynamodb.ITable
  commentsTable: dynamodb.ITable
  usersTable: dynamodb.ITable
  attachmentsBucket: s3.IBucket
  /** 追加の CORS 許可オリジン（CloudFront URL 等） */
  corsAllowOrigins?: string[]
}

interface LambdaDef {
  id: string
  functionName: string
  entry: string
  description: string
}

/**
 * Lambda（5 関数）+ HTTP API + Cognito JWT Authorizer
 *
 * ルート定義は scripts/lib/config.mjs の API_ROUTES と揃えている。
 */
export class BackendStack extends cdk.NestedStack {
  public readonly httpApi: apigwv2.HttpApi
  public readonly apiUrl: string
  public readonly functions: Record<string, lambda.IFunction>

  constructor(scope: Construct, id: string, props: BackendStackProps) {
    super(scope, id, props)

    const { config } = props
    // ts-node 実行時: infra/lib/stacks → リポジトリルート/backend
    const backendRoot = path.resolve(__dirname, '../../../backend')
    const backendSrc = path.join(backendRoot, 'src')

    const commonEnv: Record<string, string> = {
      PROJECTS_TABLE: props.projectsTable.tableName,
      TASKS_TABLE: props.tasksTable.tableName,
      COMMENTS_TABLE: props.commentsTable.tableName,
      USERS_TABLE: props.usersTable.tableName,
      ATTACHMENTS_BUCKET: props.attachmentsBucket.bucketName,
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      NODE_OPTIONS: '--enable-source-maps',
    }

    const nodejsDefaults: Partial<NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      architecture: lambda.Architecture.X86_64,
      environment: commonEnv,
      projectRoot: backendRoot,
      depsLockFilePath: path.join(backendRoot, 'package-lock.json'),
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: OutputFormat.ESM,
        banner:
          "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ['module', 'main'],
      },
      tracing: lambda.Tracing.ACTIVE,
    }

    const defs: LambdaDef[] = [
      {
        id: 'ProjectsFn',
        functionName: `${config.prefix}-projects`,
        entry: path.join(backendSrc, 'projects/handler.ts'),
        description: 'Projects / members API',
      },
      {
        id: 'TasksFn',
        functionName: `${config.prefix}-tasks`,
        entry: path.join(backendSrc, 'tasks/handler.ts'),
        description: 'Tasks API',
      },
      {
        id: 'CommentsFn',
        functionName: `${config.prefix}-comments`,
        entry: path.join(backendSrc, 'comments/handler.ts'),
        description: 'Comments API',
      },
      {
        id: 'AttachmentsFn',
        functionName: `${config.prefix}-attachments`,
        entry: path.join(backendSrc, 'attachments/handler.ts'),
        description: 'Attachments Presigned URL API',
      },
      {
        id: 'DashboardFn',
        functionName: `${config.prefix}-dashboard`,
        entry: path.join(backendSrc, 'dashboard/handler.ts'),
        description: 'Dashboard /me / display-names API',
      },
    ]

    this.functions = {}
    for (const def of defs) {
      // 明示 LogGroup（logRetention 非推奨 API を避ける）
      const logGroup = new logs.LogGroup(this, `${def.id}Logs`, {
        logGroupName: `/aws/lambda/${def.functionName}`,
        retention:
          config.envName === 'prod'
            ? logs.RetentionDays.ONE_MONTH
            : logs.RetentionDays.ONE_WEEK,
        removalPolicy: config.retainResources
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
      })

      const fn = new NodejsFunction(this, def.id, {
        ...nodejsDefaults,
        functionName: def.functionName,
        entry: def.entry,
        handler: 'handler',
        description: def.description,
        logGroup,
      })
      this.functions[def.id] = fn

      // DynamoDB: 全テーブル + GSI
      props.projectsTable.grantReadWriteData(fn)
      props.tasksTable.grantReadWriteData(fn)
      props.commentsTable.grantReadWriteData(fn)
      props.usersTable.grantReadWriteData(fn)

      // 添付 S3
      props.attachmentsBucket.grantReadWrite(fn)

      // メンバー招待時の Cognito 検索
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: 'CognitoListUsersForInvite',
          actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminGetUser'],
          resources: [props.userPool.userPoolArn],
        }),
      )
    }

    // ── HTTP API + JWT Authorizer ──────────────────────────────
    const corsOrigins = unique([
      'http://localhost:5173',
      'https://taskvista-navino.net',
      'https://www.taskvista-navino.net',
      ...(props.corsAllowOrigins ?? []),
    ])

    const authorizer = new apigwAuthorizers.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      {
        jwtAudience: [props.userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    )

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${config.prefix}-api`,
      description: `TaskVista HTTP API (${config.envName})`,
      corsPreflight: {
        allowOrigins: corsOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.PATCH,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: [
          'content-type',
          'authorization',
          'x-correlation-id',
        ],
        maxAge: cdk.Duration.hours(1),
      },
      createDefaultStage: true,
      // デフォルトステージ名は $default。URL に /prod を付けない。
      // 既存フロントが /prod を期待する場合は stageName を変える（下記 note）
    })

    // 既存 deploy.config は .../prod を使っている。互換のため明示ステージも作成可。
    // ここでは $default を使い、ApiUrl を末尾スラッシュ無しで出力する。
    // 必要なら Frontend の VITE_API_BASE_URL を Outputs の ApiUrl に合わせる。

    const projects = this.functions.ProjectsFn!
    const tasks = this.functions.TasksFn!
    const comments = this.functions.CommentsFn!
    const attachments = this.functions.AttachmentsFn!
    const dashboard = this.functions.DashboardFn!

    const addRoutes = (
      methods: apigwv2.HttpMethod[],
      pathPattern: string,
      fn: lambda.IFunction,
    ) => {
      this.httpApi.addRoutes({
        path: pathPattern,
        methods,
        integration: new apigwIntegrations.HttpLambdaIntegration(
          `${fn.node.id}Integration-${pathPattern.replace(/[{}/]/g, '')}`,
          fn,
        ),
        authorizer,
      })
    }

    // projects
    addRoutes([apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST], '/projects', projects)
    addRoutes(
      [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      '/projects/{projectId}',
      projects,
    )
    addRoutes([apigwv2.HttpMethod.POST], '/projects/{projectId}/members', projects)
    addRoutes(
      [apigwv2.HttpMethod.DELETE],
      '/projects/{projectId}/members/{memberKey}',
      projects,
    )

    // tasks
    addRoutes(
      [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      '/projects/{projectId}/tasks',
      tasks,
    )
    addRoutes(
      [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      '/tasks/{taskId}',
      tasks,
    )
    addRoutes([apigwv2.HttpMethod.PATCH], '/tasks/{taskId}/status', tasks)

    // comments
    addRoutes(
      [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      '/tasks/{taskId}/comments',
      comments,
    )
    addRoutes(
      [apigwv2.HttpMethod.DELETE],
      '/tasks/{taskId}/comments/{commentId}',
      comments,
    )

    // attachments
    addRoutes([apigwv2.HttpMethod.GET], '/tasks/{taskId}/attachments', attachments)
    addRoutes(
      [apigwv2.HttpMethod.POST],
      '/tasks/{taskId}/attachments/upload-url',
      attachments,
    )
    addRoutes(
      [apigwv2.HttpMethod.GET],
      '/tasks/{taskId}/attachments/{attachmentId}/download-url',
      attachments,
    )
    addRoutes(
      [apigwv2.HttpMethod.DELETE],
      '/tasks/{taskId}/attachments/{attachmentId}',
      attachments,
    )

    // dashboard / me
    addRoutes([apigwv2.HttpMethod.GET], '/dashboard/summary', dashboard)
    addRoutes([apigwv2.HttpMethod.GET], '/dashboard/my-tasks', dashboard)
    addRoutes([apigwv2.HttpMethod.GET], '/dashboard/review-tasks', dashboard)
    addRoutes([apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT], '/me', dashboard)
    addRoutes([apigwv2.HttpMethod.POST], '/users/display-names', dashboard)

    this.apiUrl = this.httpApi.apiEndpoint

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.apiUrl,
      description: 'HTTP API base URL (no stage suffix; $default)',
      exportName: `${config.prefix}-ApiUrl`,
    })
    new cdk.CfnOutput(this, 'ApiId', {
      value: this.httpApi.apiId,
      description: 'HTTP API ID',
      exportName: `${config.prefix}-ApiId`,
    })
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
