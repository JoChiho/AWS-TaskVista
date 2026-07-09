import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getAttachmentsBucket } from '../shared/dynamodb.js'
import * as taskRepository from '../tasks/repository.js'
import type { AttachmentMeta } from '../shared/types.js'

const region = process.env.AWS_REGION ?? 'us-east-1'
const s3Client = new S3Client({ region })

const bucket = () => getAttachmentsBucket()

/** S3 アップロード用プリサインド PUT URL を生成する（15 分有効） */
export async function createUploadUrl(
  s3Key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
    ContentType: contentType,
  })
  return getSignedUrl(s3Client, command, { expiresIn: 900 })
}

/** S3 ダウンロード用プリサインド GET URL を生成する（60 分有効） */
export async function createDownloadUrl(s3Key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: s3Key,
  })
  return getSignedUrl(s3Client, command, { expiresIn: 3600 })
}

/** S3 からオブジェクトを削除する */
export async function deleteS3Object(s3Key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: s3Key,
    }),
  )
}

/** タスクの添付ファイルメタデータを更新する */
export async function updateTaskAttachments(
  taskId: string,
  attachments: AttachmentMeta[],
) {
  return taskRepository.updateTaskAttachments(taskId, attachments)
}

export { getTaskById } from '../tasks/repository.js'