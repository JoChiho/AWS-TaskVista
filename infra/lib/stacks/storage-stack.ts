import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'
import { bucketNames, tableNames, type EnvironmentConfig } from '../config'

export interface StorageStackProps extends cdk.NestedStackProps {
  config: EnvironmentConfig
}

/**
 * データストア + 添付バケット
 *
 * DynamoDB（アプリ実装に合わせたキー / GSI）:
 *   - Projects  PK: projectId              GSI: CreatedByIndex (createdBy)
 *   - Tasks     PK: projectId / SK: taskId GSI: TaskIdIndex, ProjectStatusIndex, AssigneeIndex
 *   - Comments  PK: taskId / SK: commentId
 *   - Users     PK: userId
 *
 * ※ 進捗は Task.completionPercent / status で管理するため ProgressLogs テーブルは不要。
 *
 * S3:
 *   - attachmentsBucket … 添付本体（Presigned PUT/GET。CORS 設定）
 *
 * フロント用 SPA バケットは CloudFront OAC と同一スタックに置く必要があるため
 * FrontendStack 側で作成する（NestedStack 間の循環参照を避ける）。
 */
export class StorageStack extends cdk.NestedStack {
  public readonly projectsTable: dynamodb.Table
  public readonly tasksTable: dynamodb.Table
  public readonly commentsTable: dynamodb.Table
  public readonly usersTable: dynamodb.Table
  public readonly attachmentsBucket: s3.Bucket

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props)

    const { config } = props
    const removal = config.retainResources
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY
    const names = tableNames(config)
    const buckets = bucketNames(config, cdk.Stack.of(this).account)

    // ═══════════════════════════════════════════════════════════
    // DynamoDB
    // ═══════════════════════════════════════════════════════════

    this.projectsTable = new dynamodb.Table(this, 'ProjectsTable', {
      tableName: names.projects,
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.retainResources,
      },
      removalPolicy: removal,
    })
    this.projectsTable.addGlobalSecondaryIndex({
      indexName: 'CreatedByIndex',
      partitionKey: { name: 'createdBy', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    this.tasksTable = new dynamodb.Table(this, 'TasksTable', {
      tableName: names.tasks,
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.retainResources,
      },
      removalPolicy: removal,
    })
    this.tasksTable.addGlobalSecondaryIndex({
      indexName: 'TaskIdIndex',
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })
    this.tasksTable.addGlobalSecondaryIndex({
      indexName: 'ProjectStatusIndex',
      partitionKey: { name: 'projectId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })
    this.tasksTable.addGlobalSecondaryIndex({
      indexName: 'AssigneeIndex',
      partitionKey: { name: 'assigneeId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'dueDate', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    })

    this.commentsTable = new dynamodb.Table(this, 'CommentsTable', {
      tableName: names.comments,
      partitionKey: { name: 'taskId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'commentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.retainResources,
      },
      removalPolicy: removal,
    })

    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: names.users,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.retainResources,
      },
      removalPolicy: removal,
    })

    // ═══════════════════════════════════════════════════════════
    // S3 — Attachments（Presigned、CORS 必須）
    // ═══════════════════════════════════════════════════════════
    this.attachmentsBucket = new s3.Bucket(this, 'AttachmentsBucket', {
      bucketName: buckets.attachments,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: [
            'http://localhost:5173',
            'https://*.cloudfront.net',
            'https://taskvista-navino.net',
            'https://www.taskvista-navino.net',
          ],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        {
          id: 'AbortIncompleteMultipart',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      removalPolicy: removal,
      autoDeleteObjects: !config.retainResources,
    })

    new cdk.CfnOutput(this, 'ProjectsTableName', {
      value: this.projectsTable.tableName,
      exportName: `${config.prefix}-ProjectsTable`,
    })
    new cdk.CfnOutput(this, 'TasksTableName', {
      value: this.tasksTable.tableName,
      exportName: `${config.prefix}-TasksTable`,
    })
    new cdk.CfnOutput(this, 'CommentsTableName', {
      value: this.commentsTable.tableName,
      exportName: `${config.prefix}-CommentsTable`,
    })
    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      exportName: `${config.prefix}-UsersTable`,
    })
    new cdk.CfnOutput(this, 'AttachmentsBucketName', {
      value: this.attachmentsBucket.bucketName,
      exportName: `${config.prefix}-AttachmentsBucket`,
    })
  }
}
