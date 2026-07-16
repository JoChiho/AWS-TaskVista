import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import {
  canAccessProject,
  TASK_STATUSES,
  type Task,
  type TaskAssignee,
  type TaskStatus,
} from '../shared/types.js'
import * as usersService from '../users/service.js'
import * as commentRepository from '../comments/repository.js'
import * as repository from './repository.js'

const statusSchema = z.enum(['未着手', '進行中', 'レビュー待ち', '完了', '保留'])
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const assigneeIdSchema = z.string().min(1).max(128).optional()
const assigneeNameSchema = z.string().min(1).max(100).optional()

const taskAssigneeSchema = z.object({
  userId: z.string().min(1).max(128).optional(),
  displayName: z.string().min(1).max(100),
})

const createTaskSchema = z.object({
  title: z
    .string({ required_error: 'タスク名は必須項目です' })
    .min(1, 'タスク名は必須項目です')
    .max(200, 'タスク名は200文字以内で入力してください'),
  description: z.string().max(5000).optional(),
  status: statusSchema.optional(),
  priority: prioritySchema.optional(),
  requirement: z.string().max(2000).optional(),
  /** 担当者 ID（後方互換・単一） */
  assigneeId: assigneeIdSchema,
  /** 担当者名（後方互換・単一） */
  assigneeName: assigneeNameSchema,
  /** 担当者一覧（複数） */
  assignees: z.array(taskAssigneeSchema).max(20).optional(),
  /** 完了度 0〜100 */
  completionPercent: z
    .number({ invalid_type_error: '完了度は数値で指定してください' })
    .int('完了度は整数で指定してください')
    .min(0, '完了度は 0 以上です')
    .max(100, '完了度は 100 以下です')
    .optional(),
  dueDate: z.string().max(30).optional(),
})

const updateTaskSchema = createTaskSchema.partial()

const updateStatusSchema = z.object({
  status: statusSchema,
})

/** 完了度変更時に自動連動しないステータス */
const COMPLETION_PROTECTED_STATUSES: readonly TaskStatus[] = ['レビュー待ち', '保留']

function clampCompletion(value?: number | null): number {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return 0
  return Math.min(100, Math.max(0, Math.round(Number(value))))
}

/** 0→未着手 / 1〜99→進行中 / 100→完了 */
function statusFromCompletion(percent: number): TaskStatus {
  const p = clampCompletion(percent)
  if (p <= 0) return '未着手'
  if (p >= 100) return '完了'
  return '進行中'
}

/**
 * 完了度変更後のステータス
 * - レビュー待ち / 保留 は維持（任意完了度のまま可）
 * - それ以外は完了度に連動
 */
function resolveStatusAfterCompletionChange(
  completionPercent: number,
  currentStatus: TaskStatus,
): TaskStatus {
  if (COMPLETION_PROTECTED_STATUSES.includes(currentStatus)) {
    return currentStatus
  }
  return statusFromCompletion(completionPercent)
}

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
 * 担当者を 1 人解決する
 * - フロントのドロップダウンは userId + displayName を送る
 * - 表示名はクラウド（TaskVista-Users）を最優先
 */
async function resolveOneAssignee(
  project: Awaited<ReturnType<typeof projectRepository.getProjectById>>,
  assigneeName?: string,
  assigneeId?: string,
): Promise<TaskAssignee | null> {
  const members = project?.members ?? []

  if (assigneeId) {
    const cloudName = await usersService.getDisplayName(assigneeId)
    const hit = members.find((m) => m.userId === assigneeId)
    return {
      userId: assigneeId,
      displayName:
        cloudName || hit?.displayName || assigneeName?.trim() || 'ユーザー',
    }
  }

  if (!assigneeName?.trim()) {
    return null
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
      userId: hit.userId,
      displayName: cloudName || hit.displayName || assigneeName.trim(),
    }
  }
  return {
    displayName: assigneeName.trim(),
  }
}

/**
 * 複数担当を正規化し、主担当（assigneeId/Name）と同期する
 */
async function normalizeAssignees(
  project: Awaited<ReturnType<typeof projectRepository.getProjectById>>,
  input: {
    assignees?: TaskAssignee[]
    assigneeId?: string | null
    assigneeName?: string | null
  },
): Promise<{
  assignees: TaskAssignee[]
  assigneeId?: string
  assigneeName?: string
}> {
  const rawList: Array<{ userId?: string; displayName?: string }> = []

  if (input.assignees !== undefined) {
    for (const a of input.assignees) {
      rawList.push({ userId: a.userId, displayName: a.displayName })
    }
  } else if (input.assigneeId || input.assigneeName) {
    rawList.push({
      userId: input.assigneeId || undefined,
      displayName: input.assigneeName || undefined,
    })
  }

  const resolved: TaskAssignee[] = []
  const seen = new Set<string>()

  for (const raw of rawList) {
    const one = await resolveOneAssignee(project, raw.displayName, raw.userId)
    if (!one) continue
    const key = (one.userId || one.displayName).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(one)
  }

  const primary = resolved[0]
  return {
    assignees: resolved,
    assigneeId: primary?.userId,
    assigneeName: primary?.displayName,
  }
}

/** 既存タスクから担当者配列を復元（旧データ互換） */
function assigneesFromTask(task: Task): TaskAssignee[] {
  if (task.assignees && task.assignees.length > 0) {
    return task.assignees.map((a) => ({
      userId: a.userId,
      displayName: a.displayName,
    }))
  }
  if (task.assigneeId || task.assigneeName) {
    return [
      {
        userId: task.assigneeId,
        displayName: task.assigneeName || 'ユーザー',
      },
    ]
  }
  return []
}

function toValidationFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    fields[issue.path.join('.') || 'body'] = issue.message
  }
  return fields
}

/**
 * 担当者表示名を解決する（複数対応）
 * 優先: Users クラウド名 > プロジェクト members.displayName
 */
async function enrichTaskAssignees(
  tasks: Task[],
  projectId: string,
): Promise<Task[]> {
  if (tasks.length === 0) return tasks

  const project = await projectRepository.getProjectById(projectId)
  const members = project?.members ?? []

  const memberIds = [
    ...(members.map((m) => m.userId).filter(Boolean) as string[]),
    ...tasks.flatMap((t) => {
      const ids: string[] = []
      if (t.assigneeId) ids.push(t.assigneeId)
      for (const a of t.assignees ?? []) {
        if (a.userId) ids.push(a.userId)
      }
      return ids
    }),
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
  for (const [id, name] of cloudNames) {
    if (!byUserId.has(id)) byUserId.set(id, name)
  }

  function resolveOne(
    userId?: string,
    displayName?: string,
  ): TaskAssignee | null {
    if (userId && byUserId.has(userId)) {
      return { userId, displayName: byUserId.get(userId)! }
    }
    const raw = displayName?.trim()
    if (raw && raw.includes('@')) {
      const hit = byEmail.get(raw.toLowerCase())
      if (hit) {
        return {
          userId: userId || hit.userId,
          displayName: hit.name,
        }
      }
    }
    if (raw && !raw.includes('@')) {
      const hit = members.find(
        (m) => m.displayName?.toLowerCase() === raw.toLowerCase(),
      )
      if (hit) {
        const name =
          (hit.userId && byUserId.get(hit.userId)) || hit.displayName || raw
        return {
          userId: userId || hit.userId,
          displayName: name,
        }
      }
      return { userId, displayName: raw }
    }
    if (userId) {
      return { userId, displayName: byUserId.get(userId) || 'ユーザー' }
    }
    return null
  }

  return tasks.map((t) => {
    const source = assigneesFromTask(t)
    const resolved: TaskAssignee[] = []
    const seen = new Set<string>()
    for (const a of source) {
      const one = resolveOne(a.userId, a.displayName)
      if (!one) continue
      const key = (one.userId || one.displayName).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      resolved.push(one)
    }

    // 旧データで assignees が空だが single がある場合は resolve 済みを採用
    if (resolved.length === 0 && (t.assigneeId || t.assigneeName)) {
      const one = resolveOne(t.assigneeId, t.assigneeName)
      if (one) resolved.push(one)
    }

    const primary = resolved[0]
    return {
      ...t,
      assignees: resolved,
      assigneeId: primary?.userId,
      assigneeName: primary?.displayName,
      completionPercent:
        typeof t.completionPercent === 'number'
          ? Math.min(100, Math.max(0, Math.round(t.completionPercent)))
          : t.completionPercent ?? 0,
    }
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
  const normalized = await normalizeAssignees(project, {
    assignees: parsed.data.assignees,
    assigneeId: parsed.data.assigneeId,
    assigneeName: parsed.data.assigneeName,
  })

  const now = new Date().toISOString()
  let completion =
    parsed.data.completionPercent !== undefined
      ? clampCompletion(parsed.data.completionPercent)
      : parsed.data.status === '完了'
        ? 100
        : parsed.data.status === '未着手'
          ? 0
          : 0

  let status: TaskStatus = parsed.data.status ?? '未着手'

  // 完了度が明示され、ステータスが未指定 or 連動対象のとき完了度を優先
  if (parsed.data.completionPercent !== undefined) {
    if (
      parsed.data.status === undefined ||
      !COMPLETION_PROTECTED_STATUSES.includes(parsed.data.status as TaskStatus)
    ) {
      status = statusFromCompletion(completion)
    } else {
      status = parsed.data.status as TaskStatus
    }
  } else if (status === '完了') {
    completion = 100
  } else if (status === '未着手') {
    completion = 0
  }

  const task: Task = {
    taskId: uuidv4(),
    projectId,
    title: parsed.data.title,
    description: parsed.data.description,
    status,
    priority: parsed.data.priority ?? 'medium',
    requirement: parsed.data.requirement,
    assigneeId: normalized.assigneeId,
    assigneeName: normalized.assigneeName,
    assignees: normalized.assignees,
    completionPercent: completion,
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
  const updates: Parameters<typeof repository.updateTask>[1] = { ...parsed.data }

  const touchesAssignees =
    parsed.data.assignees !== undefined ||
    parsed.data.assigneeId !== undefined ||
    parsed.data.assigneeName !== undefined

  if (touchesAssignees) {
    // assignees: [] または assigneeId/Name 空 → クリア
    const clearingSingle =
      (parsed.data.assigneeId === '' || parsed.data.assigneeId === null) &&
      (parsed.data.assigneeName === '' ||
        parsed.data.assigneeName === null ||
        parsed.data.assigneeName === undefined) &&
      parsed.data.assignees === undefined

    const clearingList =
      parsed.data.assignees !== undefined && parsed.data.assignees.length === 0

    if (clearingList || clearingSingle) {
      updates.assignees = []
      updates.assigneeId = undefined
      updates.assigneeName = undefined
      updates.clearAssignees = true
    } else {
      const normalized = await normalizeAssignees(project, {
        assignees: parsed.data.assignees,
        assigneeId:
          parsed.data.assigneeId === '' || parsed.data.assigneeId === null
            ? undefined
            : parsed.data.assigneeId,
        assigneeName:
          parsed.data.assigneeName === '' || parsed.data.assigneeName === null
            ? undefined
            : parsed.data.assigneeName,
      })
      updates.assignees = normalized.assignees
      updates.assigneeId = normalized.assigneeId
      updates.assigneeName = normalized.assigneeName
      updates.clearAssignees = normalized.assignees.length === 0
    }
  }

  // 明示ステータスのみ（フォームは完了度を送らない）:
  // 完了 → 100 / 未着手 → 0。レビュー待ち・保留は完了度を触らない
  if (parsed.data.status !== undefined && parsed.data.completionPercent === undefined) {
    if (parsed.data.status === '完了' && (existing.completionPercent ?? 0) < 100) {
      updates.completionPercent = 100
    } else if (parsed.data.status === '未着手' && (existing.completionPercent ?? 0) !== 0) {
      updates.completionPercent = 0
    }
  }

  // 完了度のみ更新（または完了度あり・ステータス未指定）: 連動
  // レビュー待ち / 保留 は維持。0→未着手 / 1〜99→進行中 / 100→完了
  if (
    parsed.data.completionPercent !== undefined &&
    parsed.data.status === undefined
  ) {
    const nextStatus = resolveStatusAfterCompletionChange(
      parsed.data.completionPercent,
      existing.status,
    )
    if (nextStatus !== existing.status) {
      updates.status = nextStatus
    }
  }

  // 両方指定時: ステータスを優先（レビュー待ち/保留を任意完了度で保持するため）
  // 連動対象ステータス同士の矛盾は完了度側に寄せる（フォーム連動の保険）
  if (
    parsed.data.completionPercent !== undefined &&
    parsed.data.status !== undefined &&
    !COMPLETION_PROTECTED_STATUSES.includes(parsed.data.status as TaskStatus)
  ) {
    const mapped = statusFromCompletion(parsed.data.completionPercent)
    // 明示が保護外で、完了度と明らかに矛盾する場合は完了度を優先
    if (
      (parsed.data.status === '完了' && clampCompletion(parsed.data.completionPercent) < 100) ||
      (parsed.data.status === '未着手' && clampCompletion(parsed.data.completionPercent) > 0) ||
      (parsed.data.status === '進行中' &&
        (clampCompletion(parsed.data.completionPercent) === 0 ||
          clampCompletion(parsed.data.completionPercent) === 100))
    ) {
      updates.status = mapped
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

  const status = parsed.data.status as TaskStatus
  // かんばん: 完了→100% / 未着手→0%。レビュー待ち・保留は完了度を触らない
  if (status === '完了') {
    return repository.updateTask(taskId, { status, completionPercent: 100 })
  }
  if (status === '未着手') {
    return repository.updateTask(taskId, { status, completionPercent: 0 })
  }
  return repository.updateTask(taskId, { status })
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
