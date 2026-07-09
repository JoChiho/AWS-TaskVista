import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const region = process.env.AWS_REGION ?? 'us-east-1'

const client = new DynamoDBClient({ region })

/** DynamoDB Document Client（共有インスタンス） */
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

export function getProjectsTable(): string {
  return process.env.PROJECTS_TABLE ?? 'TaskVista-Projects'
}

export function getTasksTable(): string {
  return process.env.TASKS_TABLE ?? 'TaskVista-Tasks'
}

export function getCommentsTable(): string {
  return process.env.COMMENTS_TABLE ?? 'TaskVista-Comments'
}

export function getAttachmentsBucket(): string {
  return process.env.ATTACHMENTS_BUCKET ?? 'taskvista-attachments'
}