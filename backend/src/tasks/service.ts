import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import { canAccessProject, TASK_STATUSES, type Task, type TaskStatus } from '../shared/types.js'
import * as usersService from '../users/service.js'
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

/**
 * 担当者を解決する
 * - フロントのドロップダウンは userId + displayName を送る
 * - 表示名はクラウド（TaskVista-Users）を最優先
 * - 名前のみの場合はプロジェクトメンバーから userId を推測する
 */
async function resolveAssignee(
  project: Awaited<ReturnType<typeof projectRepository.getProjectById>>,
  assigneeName?: string,
  assigneeId?: string,
): Promise<{ assigneeId?: string; assigneeName?: string }> {
  const members = project?.members ?? []

  // 明示的に userId が来た場合（ドロップダウン選択）
  if (assigneeId) {
    const cloudName = await usersService.getDisplayName(assigneeId)
    const hit = members.find((m) => m.userId === assigneeId)
    return {
      assigneeId,
      assigneeName:
        cloudName || hit?.displayName || assigneeName?.trim() || undefined,
    }
  }

  // 名前のみ（後方互換）
  if (!assigneeName?.trim()) {
    return { assigneeId: undefined, assigneeName: undefined }
  }
  const name = assigneeName.trim().toLowerCase()
  const hit = members.find(
    (m) =>
      m.displayName.toLowerCase() === name ||
      m.email.toLowerCase() === name ||
      m.email.toLowerCase().startsWith(name),
  )
  if (hit?.userId) {
    const cloudName = await usersService.getDisplayName(hit.userId)
    return {
      assigneeId: hit.userId,
      assigneeName: cloudName || hit.displayName || assigneeName.trim(),
    }
  }
  return {
    assigneeId: undefined,
    assigneeName: assigneeName.trim(),
  }
}

function toValidationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    fields[issue.path.join('.') || 'body'] = issue.message
  }
  return fields
}

/**
 * 担当者表示名を解決する
 * 優先: Users クラウド名 > プロジェクト members.displayName
 * 古いデータで assigneeName にメールが入っている場合も members.email から人名に変換する
 */
async function enrichTaskAssignees(
  tasks: Task[],
  projectId: string,
): Promise<Task[]> {
  if (tasks.length === 0) return tasks

  const project = await projectRepository.getProjectById(projectId)
  const members = project?.members ?? []

  const memberIds = [
    ...members.map((m) => m.userId).filter(Boolean) as string[],
    ...tasks.map((t) => t.assigneeId).filter(Boolean) as string[],
  ]
  const cloudNames = await usersService.getDisplayNameMap(memberIds)

  const byUserId = new Map<string, string>()
  const byEmail = new Map<string, { name: string; userId?: string }>()

  for (const m of members) {
    const name =
      (m.userId && cloudNames.get(m.userId)) ||
      (m.displayName && !m.displayName.includes('@') ? m.displayName : null) ||
      null
    if (!name) continue
    if (m.userId) byUserId.set(m.userId, name)
    if (m.email) {
      byEmail.set(m.email.trim().toLowerCase(), {
        name,
        userId: m.userId,
      })
    }
  }
  // クラウドのみ（members に無い assigneeId）
  for (const [id, name] of cloudNames) {
    if (!byUserId.has(id)) byUserId.set(id, name)
  }

  return tasks.map((t) => {
    // 1) assigneeId → 表示名
    if (t.assigneeId && byUserId.has(t.assigneeId)) {
      return { ...t, assigneeName: byUserId.get(t.assigneeId)! }
    }
    // 2) assigneeName がメール → メンバー表
    const raw = t.assigneeName?.trim()
    if (raw && raw.includes('@')) {
      const hit = byEmail.get(raw.toLowerCase())
      if (hit) {
        return {
          ...t,
          assigneeId: t.assigneeId || hit.userId,
          assigneeName: hit.name,
        }
      }
    }
    // 3) assigneeName がメンバー displayName と一致 → userId 補完
    if (raw && !raw.includes('@')) {
      const hit = members.find(
        (m) => m.displayName?.toLowerCase() === raw.toLowerCase(),
      )
      if (hit) {
        const name =
          (hit.userId && byUserId.get(hit.userId)) || hit.displayName || raw
        return {
          ...t,
          assigneeId: t.assigneeId || hit.userId,
          assigneeName: name,
        }
      }
    }
    return t
  })
}

/** プロジェクト内のタスク一覧を取得する */
export async function listTasksByProject(
  projectId: string,
  userId: string,
  email?: string,
): Promise<Task[]> {
  await assertProjectAccess(projectId, userId, email)
  const tasks = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  return enrichTaskAssignees(tasks, projectId)
}

/** タスク詳細を取得する（コメント数を含む） */
export async function getTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task & { commentCount: number }> {
  const task = await getAccessibleTask(taskId, userId, email)
  const [enriched] = await enrichTaskAssignees([task], task.projectId)
  const comments = await commentRepository.listCommentsByTask(taskId)
  return { ...enriched, commentCount: comments.length }
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
  const assignee = await resolveAssignee(
    project,
    parsed.data.assigneeName,
    parsed.data.assigneeId,
  )

  const now = new Date().toISOString()
  const task: Task = {
    taskId: uuidv4(),
    projectId,
    title: parsed.data.title,
    description: parsed.data.description,
    status: parsed.data.status ?? '未着手',
    priority: parsed.data.priority ?? 'medium',
    requirement: parsed.data.requirement,
    assigneeId: assignee.assigneeId,
    assigneeName: assignee.assigneeName,
    dueDate: parsed.data.dueDate,
    attachments: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }

  const created = await repository.createTask(task)
  const [enriched] = await enrichTaskAssignees([created], projectId)
  return enriched
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
    // 空文字は「担当者クリア」
    const rawId =
      updates.assigneeId === '' || updates.assigneeId === null
        ? undefined
        : updates.assigneeId ?? existing.assigneeId
    const rawName =
      updates.assigneeName === '' || updates.assigneeName === null
        ? undefined
        : updates.assigneeName ?? existing.assigneeName
    const assignee = await resolveAssignee(project, rawName, rawId)
    // 両方クリアされた場合はフィールドを空にする
    if (!updates.assigneeId && !updates.assigneeName && !rawId && !rawName) {
      updates.assigneeId = undefined
      updates.assigneeName = undefined
    } else {
      updates.assigneeId = assignee.assigneeId
      updates.assigneeName = assignee.assigneeName
    }
  }

  const updated = await repository.updateTask(taskId, updates)
  const [enriched] = await enrichTaskAssignees([updated], existing.projectId)
  return enriched
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