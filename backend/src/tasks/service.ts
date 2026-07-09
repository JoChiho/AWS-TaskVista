import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import { canAccessProject, TASK_STATUSES, type Task, type TaskStatus } from '../shared/types.js'
import * as commentRepository from '../comments/repository.js'
import * as repository from './repository.js'

const statusSchema = z.enum(['未着手', '進行中', 'レビュー待ち', '完了', '保留'])
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const assigneeIdSchema = z.string().min(1).max(128).optional()
const assigneeNameSchema = z.string().min(1).max(100).optional()

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
  /** 担当者 ID（任意・メンバー選択時など） */
  assigneeId: assigneeIdSchema,
  /** 担当者名（人名テキスト。主にこちらを利用） */
  assigneeName: assigneeNameSchema,
  dueDate: z.string().max(30).optional(),
})

const updateTaskSchema = createTaskSchema.partial()

const updateStatusSchema = z.object({
  status: statusSchema,
})

async function assertProjectAccess(
  projectId: string,
  userId: string,
  email?: string,
): Promise<void> {
  const project = await projectRepository.getProjectById(projectId)
  if (!project || project.isDeleted) {
    throw new NotFoundError('プロジェクトが見つかりません')
  }
  if (!canAccessProject(project, userId, email)) {
    throw new ForbiddenError('このプロジェクトへのアクセス権限がありません')
  }
}

async function getAccessibleTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task> {
  const task = await repository.getTaskById(taskId)
  if (!task || task.isDeleted) {
    throw new NotFoundError('タスクが見つかりません')
  }
  await assertProjectAccess(task.projectId, userId, email)
  return task
}

/** 担当者名からプロジェクトメンバーの userId を推測する */
function resolveAssigneeId(
  project: Awaited<ReturnType<typeof projectRepository.getProjectById>>,
  assigneeName?: string,
  assigneeId?: string,
): string | undefined {
  if (assigneeId) return assigneeId
  if (!assigneeName || !project?.members) return undefined
  const name = assigneeName.trim().toLowerCase()
  const hit = project.members.find(
    (m) =>
      m.displayName.toLowerCase() === name ||
      m.email.toLowerCase() === name ||
      m.email.toLowerCase().startsWith(name),
  )
  return hit?.userId
}

function toValidationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    fields[issue.path.join('.') || 'body'] = issue.message
  }
  return fields
}

/** プロジェクト内のタスク一覧を取得する */
export async function listTasksByProject(
  projectId: string,
  userId: string,
  email?: string,
): Promise<Task[]> {
  await assertProjectAccess(projectId, userId, email)
  const tasks = await repository.listTasksByProject(projectId)
  return tasks.filter((t) => !t.isDeleted)
}

/** タスク詳細を取得する（コメント数を含む） */
export async function getTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task & { commentCount: number }> {
  const task = await getAccessibleTask(taskId, userId, email)
  const comments = await commentRepository.listCommentsByTask(taskId)
  return { ...task, commentCount: comments.length }
}

/** タスクを新規作成する */
export async function createTask(
  projectId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task> {
  await assertProjectAccess(projectId, userId, email)

  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }

  const project = await projectRepository.getProjectById(projectId)
  const assigneeName = parsed.data.assigneeName?.trim() || undefined
  const assigneeId = resolveAssigneeId(project, assigneeName, parsed.data.assigneeId)

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
    assigneeId,
    assigneeName,
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
  email?: string,
): Promise<Task> {
  const existing = await getAccessibleTask(taskId, userId, email)

  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new ValidationError('更新する項目が指定されていません')
  }

  const project = await projectRepository.getProjectById(existing.projectId)
  const updates = { ...parsed.data }
  if (updates.assigneeName !== undefined || updates.assigneeId !== undefined) {
    const assigneeName =
      updates.assigneeName !== undefined
        ? updates.assigneeName?.trim() || undefined
        : existing.assigneeName
    updates.assigneeName = assigneeName
    updates.assigneeId = resolveAssigneeId(
      project,
      assigneeName,
      updates.assigneeId ?? existing.assigneeId,
    )
  }

  return repository.updateTask(taskId, updates)
}

/** タスクのステータスのみを更新する（かんばんドラッグ専用） */
export async function updateTaskStatus(
  taskId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task> {
  await getAccessibleTask(taskId, userId, email)

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
export async function deleteTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task> {
  await getAccessibleTask(taskId, userId, email)
  return repository.softDeleteTask(taskId)
}