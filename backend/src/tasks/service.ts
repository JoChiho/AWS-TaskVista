import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import { canAccessProject, TASK_STATUSES, type Task, type TaskStatus } from '../shared/types.js'
import * as commentRepository from '../comments/repository.js'
import * as repository from './repository.js'

const statusSchema = z.enum(['未着手', '進行中', 'レビュー待ち', '完了', '保留'])
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const assigneeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, '担当者 ID の形式が正しくありません')

const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'タイトルは必須項目です' })
    .min(1, 'タイトルは必須項目です')
    .max(200, 'タイトルは200文字以内で入力してください'),
  description: z.string().max(5000).optional(),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  location: z.string().max(200).optional(),
  requirement: z.string().max(2000).optional(),
  assigneeId: assigneeIdSchema.optional(),
  dueDate: z.string().max(30).optional(),
})

const updateTaskSchema = createTaskSchema.partial()

const updateStatusSchema = z.object({
  status: statusSchema,
})

async function assertProjectAccess(projectId: string, userId: string): Promise<void> {
  const project = await projectRepository.getProjectById(projectId)
  if (!project || project.isDeleted) {
    throw new NotFoundError('プロジェクトが見つかりません')
  }
  if (!canAccessProject(project, userId)) {
    throw new ForbiddenError('このプロジェクトへのアクセス権限がありません')
  }
}

async function getAccessibleTask(taskId: string, userId: string): Promise<Task> {
  const task = await repository.getTaskById(taskId)
  if (!task || task.isDeleted) {
    throw new NotFoundError('タスクが見つかりません')
  }
  await assertProjectAccess(task.projectId, userId)
  return task
}

function toValidationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    fields[issue.path.join('.') || 'body'] = issue.message
  }
  return fields
}

/** プロジェクト内のタスク一覧を取得する */
export async function listTasksByProject(projectId: string, userId: string): Promise<Task[]> {
  await assertProjectAccess(projectId, userId)
  const tasks = await repository.listTasksByProject(projectId)
  return tasks.filter((t) => !t.isDeleted)
}

/** タスク詳細を取得する（コメント数を含む） */
export async function getTask(taskId: string, userId: string): Promise<Task & { commentCount: number }> {
  const task = await getAccessibleTask(taskId, userId)
  const comments = await commentRepository.listCommentsByTask(taskId)
  return { ...task, commentCount: comments.length }
}

/** タスクを新規作成する */
export async function createTask(
  projectId: string,
  userId: string,
  body: unknown,
): Promise<Task> {
  await assertProjectAccess(projectId, userId)

  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }

  const now = new Date().toISOString()
  const task: Task = {
    taskId: uuidv4(),
    projectId,
    title: parsed.data.title,
    description: parsed.data.description,
    status: parsed.data.status ?? '未着手',
    priority: parsed.data.priority ?? 'medium',
    location: parsed.data.location,
    requirement: parsed.data.requirement,
    assigneeId: parsed.data.assigneeId,
    dueDate: parsed.data.dueDate,
    attachments: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }

  return repository.createTask(task)
}

/** タスク情報を更新する */
export async function updateTask(
  taskId: string,
  userId: string,
  body: unknown,
): Promise<Task> {
  await getAccessibleTask(taskId, userId)

  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new ValidationError('更新する項目が指定されていません')
  }

  return repository.updateTask(taskId, parsed.data)
}

/** タスクのステータスのみを更新する（かんばんドラッグ専用） */
export async function updateTaskStatus(
  taskId: string,
  userId: string,
  body: unknown,
): Promise<Task> {
  await getAccessibleTask(taskId, userId)

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError(
      `ステータスは次のいずれかを指定してください: ${TASK_STATUSES.join('、')}`,
      { status: `許可値: ${TASK_STATUSES.join(', ')}` },
    )
  }

  return repository.updateTaskStatus(taskId, parsed.data.status as TaskStatus)
}

/** タスクを論理削除する */
export async function deleteTask(taskId: string, userId: string): Promise<Task> {
  await getAccessibleTask(taskId, userId)
  return repository.softDeleteTask(taskId)
}