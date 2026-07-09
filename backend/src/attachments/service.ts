import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import { canAccessProject, type AttachmentMeta } from '../shared/types.js'
import * as repository from './repository.js'

const MAX_FILE_SIZE = 50 * 1024 * 1024

const uploadUrlSchema = z.object({
  filename: z.string().min(1, 'ファイル名は必須項目です').max(255),
  contentType: z.string().min(1, 'Content-Type は必須項目です'),
  sizeBytes: z
    .number({ required_error: 'ファイルサイズは必須項目です' })
    .int()
    .positive()
    .max(MAX_FILE_SIZE, 'ファイルサイズが上限（50MB）を超えています'),
})

async function getAccessibleTask(taskId: string, userId: string, email?: string) {
  const task = await repository.getTaskById(taskId)
  if (!task || task.isDeleted) {
    throw new NotFoundError('タスクが見つかりません')
  }

  const project = await projectRepository.getProjectById(task.projectId)
  if (!project || project.isDeleted) {
    throw new NotFoundError('プロジェクトが見つかりません')
  }

  if (!canAccessProject(project, userId, email)) {
    throw new ForbiddenError('このタスクへのアクセス権限がありません')
  }

  return task
}

/** 添付ファイル一覧を取得する */
export async function listAttachments(taskId: string, userId: string): Promise<AttachmentMeta[]> {
  const task = await getAccessibleTask(taskId, userId)
  return task.attachments ?? []
}

/** アップロード用プリサインド URL を取得する */
export async function getUploadUrl(
  taskId: string,
  userId: string,
  body: unknown,
): Promise<{ uploadUrl: string; attachmentId: string; s3Key: string }> {
  await getAccessibleTask(taskId, userId)

  const parsed = uploadUrlSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'body'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  const attachmentId = uuidv4()
  const s3Key = `tasks/${taskId}/${attachmentId}-${parsed.data.filename}`
  const uploadUrl = await repository.createUploadUrl(s3Key, parsed.data.contentType)

  const task = await repository.getTaskById(taskId)
  const attachments = [...(task?.attachments ?? [])]
  const meta: AttachmentMeta = {
    attachmentId,
    filename: parsed.data.filename,
    s3Key,
    contentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    uploadedBy: userId,
    uploadedAt: new Date().toISOString(),
  }
  attachments.push(meta)
  await repository.updateTaskAttachments(taskId, attachments)

  return { uploadUrl, attachmentId, s3Key }
}

/** ダウンロード用プリサインド URL を取得する */
export async function getDownloadUrl(
  taskId: string,
  attachmentId: string,
  userId: string,
): Promise<string> {
  const task = await getAccessibleTask(taskId, userId)
  const attachment = task.attachments?.find((a) => a.attachmentId === attachmentId)

  if (!attachment) {
    throw new NotFoundError('添付ファイルが見つかりません')
  }

  return repository.createDownloadUrl(attachment.s3Key)
}

/** 添付ファイルを削除する */
export async function deleteAttachment(
  taskId: string,
  attachmentId: string,
  userId: string,
): Promise<void> {
  const task = await getAccessibleTask(taskId, userId)
  const attachment = task.attachments?.find((a) => a.attachmentId === attachmentId)

  if (!attachment) {
    throw new NotFoundError('添付ファイルが見つかりません')
  }

  await repository.deleteS3Object(attachment.s3Key)
  const attachments = task.attachments.filter((a) => a.attachmentId !== attachmentId)
  await repository.updateTaskAttachments(taskId, attachments)
}