import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import * as taskRepository from '../tasks/repository.js'
import { canAccessProject, type Comment } from '../shared/types.js'
import * as usersService from '../users/service.js'
import * as repository from './repository.js'

const createCommentSchema = z.object({
  content: z
    .string({ required_error: 'コメント内容は必須項目です' })
    .min(1, 'コメント内容は必須項目です')
    .max(2000, 'コメントは2000文字以内で入力してください'),
  /** 表示名（フロントのプロフィール名を優先） */
  authorDisplayName: z.string().min(1).max(100).optional(),
})

async function assertTaskAccess(
  taskId: string,
  userId: string,
  email?: string,
): Promise<void> {
  const task = await taskRepository.getTaskById(taskId)
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
}

/** タスクのコメント一覧を取得する（投稿者名はクラウドプロフィールで解決） */
export async function listComments(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Comment[]> {
  await assertTaskAccess(taskId, userId, email)
  const comments = await repository.listCommentsByTask(taskId)
  const names = await usersService.getDisplayNameMap(comments.map((c) => c.authorId))
  return comments.map((c) => ({
    ...c,
    authorName: names.get(c.authorId) || c.authorName,
  }))
}

/** コメントを作成する */
export async function createComment(
  taskId: string,
  userId: string,
  authorName: string,
  body: unknown,
  email?: string,
): Promise<Comment> {
  await assertTaskAccess(taskId, userId, email)

  const parsed = createCommentSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'content'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  // クラウドに保存済みの表示名を最優先
  const cloudName = await usersService.getDisplayName(userId)
  const now = new Date().toISOString()
  const comment: Comment = {
    commentId: uuidv4(),
    taskId,
    content: parsed.data.content,
    authorId: userId,
    authorName:
      cloudName ||
      parsed.data.authorDisplayName?.trim() ||
      authorName,
    createdAt: now,
    updatedAt: now,
  }

  return repository.createComment(comment)
}

/** コメントを削除する（作成者のみ） */
export async function deleteComment(
  taskId: string,
  commentId: string,
  userId: string,
  email?: string,
): Promise<void> {
  await assertTaskAccess(taskId, userId, email)

  const comment = await repository.getCommentById(taskId, commentId)
  if (!comment) {
    throw new NotFoundError('コメントが見つかりません')
  }

  if (comment.authorId !== userId) {
    throw new ForbiddenError('コメントの削除権限がありません')
  }

  await repository.deleteComment(taskId, commentId)
}