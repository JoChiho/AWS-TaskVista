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
import {
  buildById,
  childrenOf,
  collectDescendantIds,
  deriveParentStatusPolicy,
  enrichWithWbs,
  exceedsMaxDepth,
  isParentStatusAllowed,
  isTaskNodeType,
  nextSortOrder,
  nextWbsCode,
  planMissingWbsCodes,
  planFullWbsRenumber,
  renumberSubtreeCodes,
  resolveParentStatus,
  touchesParentLockedFields,
  wouldCreateCycle,
  WBS_MAX_DEPTH,
} from './wbs.js'
import type { TaskStatus as SharedTaskStatus } from '../shared/types.js'

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
  /** 評価者一覧（レビュー待ち向け・複数可） */
  reviewers: z.array(taskAssigneeSchema).max(20).optional(),
  /** 完了度 0〜100 */
  completionPercent: z
    .number({ invalid_type_error: '進捗は数値で指定してください' })
    .int('進捗は整数で指定してください')
    .min(0, '進捗は 0 以上です')
    .max(100, '進捗は 100 以下です')
    .optional(),
  /** 予定工数（人日） */
  estimatedEffortDays: z
    .number({ invalid_type_error: '予定工数は数値で指定してください' })
    .min(0, '予定工数は 0 以上です')
    .max(10000, '予定工数は 10000 人日以内です')
    .optional()
    .nullable(),
  /** 実績工数（人日） */
  actualEffortDays: z
    .number({ invalid_type_error: '実績工数は数値で指定してください' })
    .min(0, '実績工数は 0 以上です')
    .max(10000, '実績工数は 10000 人日以内です')
    .optional()
    .nullable(),
  /** 予定開始日 YYYY-MM-DD（空文字 / null はクリア） */
  plannedStartDate: z
    .union([
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '予定開始日は YYYY-MM-DD 形式で指定してください'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  /** 予定締切日 YYYY-MM-DD（空文字 / null はクリア） */
  plannedDueDate: z
    .union([
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '予定終了日は YYYY-MM-DD 形式で指定してください'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  /** 実績開始日 YYYY-MM-DD（空文字 / null はクリア） */
  actualStartDate: z
    .union([
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '実績開始日は YYYY-MM-DD 形式で指定してください'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  /** 実績締切日 YYYY-MM-DD（空文字 / null はクリア） */
  actualDueDate: z
    .union([
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, '実績終了日は YYYY-MM-DD 形式で指定してください'),
      z.literal(''),
      z.null(),
    ])
    .optional(),
  /** WBS: 親タスク ID（空 / null = ルート） */
  parentTaskId: z
    .union([z.string().min(1).max(128), z.literal(''), z.null()])
    .optional(),
  /** WBS 番号 */
  wbsCode: z.string().min(1).max(64).optional().nullable(),
  /** 同一親内の並び */
  sortOrder: z.number().int().min(0).max(100000).optional().nullable(),
  /** ノード種別 */
  nodeType: z.enum(['summary', 'work_package', 'milestone']).optional().nullable(),
})

/** 日付フィールド: 空 / null → 削除、YYYY-MM-DD → 保存、undefined → 触らない */
function optionalDateUpdate(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined
  if (value === '' || value === null) return null
  return value
}

/**
 * 旧 startDate/dueDate を予定日へ寄せ、API レスポンスを正規化する
 */
function presentTask(task: Task): Task {
  const plannedStartDate = task.plannedStartDate ?? task.startDate
  const plannedDueDate = task.plannedDueDate ?? task.dueDate
  const {
    startDate: _legacyStart,
    ...rest
  } = task
  return {
    ...rest,
    ...(plannedStartDate ? { plannedStartDate } : {}),
    ...(plannedDueDate ? { plannedDueDate, dueDate: plannedDueDate } : {}),
  }
}

const updateTaskSchema = createTaskSchema.partial()

const updateStatusSchema = z.object({
  status: statusSchema,
})

/** POST /tasks/{id}/move */
const moveTaskSchema = z.object({
  /** null / "" = ルートへ。必須 */
  newParentId: z.union([z.string().min(1).max(128), z.null(), z.literal('')]),
  sortOrder: z.number().int().min(0).max(100000).optional().nullable(),
})

/** POST /projects/{id}/tasks/reorder */
const reorderTasksSchema = z.object({
  /**
   * 並べ替え対象の親（null / "" / 省略 = ルート直下）
   * 全 items がこの親の子であることを検証する
   */
  parentTaskId: z
    .union([z.string().min(1).max(128), z.null(), z.literal('')])
    .optional(),
  items: z
    .array(
      z.object({
        taskId: z.string().min(1).max(128),
        sortOrder: z.number().int().min(0).max(100000),
      }),
    )
    .min(1, '並べ替え対象を 1 件以上指定してください')
    .max(500),
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

/**
 * 評価者を正規化する（担当者と同じ解決ロジック）
 */
async function normalizeReviewers(
  project: Awaited<ReturnType<typeof projectRepository.getProjectById>>,
  reviewers: TaskAssignee[] | undefined,
): Promise<TaskAssignee[]> {
  if (reviewers === undefined) return []
  const resolved: TaskAssignee[] = []
  const seen = new Set<string>()
  for (const raw of reviewers) {
    const one = await resolveOneAssignee(project, raw.displayName, raw.userId)
    if (!one) continue
    const key = (one.userId || one.displayName).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push(one)
  }
  return resolved
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

function reviewersFromTask(task: Task): TaskAssignee[] {
  if (task.reviewers && task.reviewers.length > 0) {
    return task.reviewers.map((a) => ({
      userId: a.userId,
      displayName: a.displayName,
    }))
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
      for (const r of t.reviewers ?? []) {
        if (r.userId) ids.push(r.userId)
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

    const revSource = reviewersFromTask(t)
    const revResolved: TaskAssignee[] = []
    const revSeen = new Set<string>()
    for (const a of revSource) {
      const one = resolveOne(a.userId, a.displayName)
      if (!one) continue
      const key = (one.userId || one.displayName).toLowerCase()
      if (revSeen.has(key)) continue
      revSeen.add(key)
      revResolved.push(one)
    }

    const primary = resolved[0]
    return presentTask({
      ...t,
      assignees: resolved,
      assigneeId: primary?.userId,
      assigneeName: primary?.displayName,
      reviewers: revResolved,
      completionPercent:
        typeof t.completionPercent === 'number'
          ? Math.min(100, Math.max(0, Math.round(t.completionPercent)))
          : t.completionPercent ?? 0,
    })
  })
}

/**
 * 欠落 WBS 番号を補完して DB に書き戻す（一覧・詳細の前処理）
 * 後から親を付けたタスクや導入前データ向け
 */
async function ensureWbsCodesPersisted(_projectId: string, tasks: Task[]): Promise<Task[]> {
  const patches = planMissingWbsCodes(tasks)
  if (patches.length === 0) return tasks

  const byId = new Map(tasks.map((t) => [t.taskId, t]))
  for (const p of patches) {
    const cur = byId.get(p.taskId)
    if (!cur) continue
    try {
      const updated = await repository.updateTask(p.taskId, { wbsCode: p.wbsCode })
      // モックが undefined を返す場合もパッチを反映
      byId.set(
        p.taskId,
        updated && updated.taskId
          ? updated
          : { ...cur, wbsCode: p.wbsCode },
      )
    } catch {
      byId.set(p.taskId, { ...cur, wbsCode: p.wbsCode })
    }
  }
  // 元の並びを保つ
  return tasks.map((t) => byId.get(t.taskId) ?? t)
}

/** プロジェクト内のタスク一覧を取得する（WBS childCount / rollup 付き） */
export async function listTasksByProject(
  projectId: string,
  userId: string,
  email?: string,
): Promise<Task[]> {
  await assertProjectAccess(projectId, userId, email)
  let tasks = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  tasks = await ensureWbsCodesPersisted(projectId, tasks)
  const enriched = await enrichTaskAssignees(tasks, projectId)
  return enrichWithWbs(enriched)
}

/** タスク詳細を取得する（コメント数・WBS 集計を含む） */
export async function getTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task & { commentCount: number }> {
  const task = await getAccessibleTask(taskId, userId, email)
  let projectTasks = (await repository.listTasksByProject(task.projectId)).filter(
    (t) => !t.isDeleted,
  )
  projectTasks = await ensureWbsCodesPersisted(task.projectId, projectTasks)
  const enrichedAll = await enrichTaskAssignees(projectTasks, task.projectId)
  const withWbs = enrichWithWbs(enrichedAll)
  const self = withWbs.find((t) => t.taskId === taskId) ?? withWbs[0]
  const comments = await commentRepository.listCommentsByTask(taskId)
  return { ...self, commentCount: comments.length }
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
  const reviewers =
    parsed.data.reviewers !== undefined
      ? await normalizeReviewers(project, parsed.data.reviewers)
      : []

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

  // WBS: 親・番号・並び
  const projectTasks = (await repository.listTasksByProject(projectId)).filter(
    (t) => !t.isDeleted,
  )
  let parentTaskId: string | undefined
  const rawParent = parsed.data.parentTaskId
  if (rawParent && rawParent !== '') {
    const parent = projectTasks.find((t) => t.taskId === rawParent)
    if (!parent) {
      throw new ValidationError('親タスクが見つかりません', {
        parentTaskId: '同一プロジェクト内のタスクを指定してください',
      })
    }
    const byId = buildById(projectTasks)
    if (exceedsMaxDepth(rawParent, byId, WBS_MAX_DEPTH)) {
      throw new ValidationError(
        `WBS の深さは ${WBS_MAX_DEPTH} 階層までです`,
        { parentTaskId: `最大 ${WBS_MAX_DEPTH} 階層` },
      )
    }
    parentTaskId = rawParent
  }
  const parent = parentTaskId
    ? projectTasks.find((t) => t.taskId === parentTaskId)
    : undefined
  const sortOrder =
    parsed.data.sortOrder != null && parsed.data.sortOrder !== undefined
      ? parsed.data.sortOrder
      : nextSortOrder(projectTasks, parentTaskId)
  const wbsCode =
    parsed.data.wbsCode && parsed.data.wbsCode.trim()
      ? parsed.data.wbsCode.trim()
      : nextWbsCode(projectTasks, parent)
  const nodeType =
    parsed.data.nodeType && isTaskNodeType(parsed.data.nodeType)
      ? parsed.data.nodeType
      : 'work_package'

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
    attachments: [],
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
    sortOrder,
    wbsCode,
    nodeType,
  }
  if (parentTaskId) {
    task.parentTaskId = parentTaskId
  }

  // オプション属性は値があるときだけ載せる（DynamoDB に確実に書き込む）
  if (
    parsed.data.estimatedEffortDays !== null &&
    parsed.data.estimatedEffortDays !== undefined
  ) {
    task.estimatedEffortDays = parsed.data.estimatedEffortDays
  }
  if (
    parsed.data.actualEffortDays !== null &&
    parsed.data.actualEffortDays !== undefined
  ) {
    task.actualEffortDays = parsed.data.actualEffortDays
  }
  if (parsed.data.plannedStartDate && parsed.data.plannedStartDate !== '') {
    task.plannedStartDate = parsed.data.plannedStartDate
  }
  if (parsed.data.plannedDueDate && parsed.data.plannedDueDate !== '') {
    task.plannedDueDate = parsed.data.plannedDueDate
    // AssigneeIndex（SK=dueDate）互換
    task.dueDate = parsed.data.plannedDueDate
  }
  if (parsed.data.actualStartDate && parsed.data.actualStartDate !== '') {
    task.actualStartDate = parsed.data.actualStartDate
  }
  if (parsed.data.actualDueDate && parsed.data.actualDueDate !== '') {
    task.actualDueDate = parsed.data.actualDueDate
  }
  if (reviewers.length > 0) {
    task.reviewers = reviewers
  }

  const created = await repository.createTask(task)
  if (created.parentTaskId) {
    await syncAncestorStatuses(projectId, created)
  }
  const all = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  const enrichedAll = await enrichTaskAssignees(all, projectId)
  const withWbs = enrichWithWbs(enrichedAll)
  return withWbs.find((t) => t.taskId === created.taskId) ?? created
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
  const projectTasks = (await repository.listTasksByProject(existing.projectId)).filter(
    (t) => !t.isDeleted,
  )
  const byId = buildById(projectTasks)
  const directChildren = projectTasks.filter((t) => t.parentTaskId === existing.taskId)
  const isParentNode = directChildren.length > 0

  // 親（子あり）: 進捗・予定/実績・担当は手入力不可。優先度・レビュアーは可。
  // ステータスは子の状態に応じた候補のみ可。
  if (isParentNode) {
    const locked = touchesParentLockedFields(parsed.data as Record<string, unknown>)
    if (locked.length > 0) {
      throw new ValidationError(
        '子タスクがある親では進捗・予定/実績・担当者を直接変更できません',
        Object.fromEntries(
          locked.map((k) => [k, '子から集計されます。子タスクを編集してください']),
        ),
      )
    }
    if (parsed.data.status !== undefined) {
      const childStatuses = directChildren.map((c) => c.status)
      if (!isParentStatusAllowed(parsed.data.status as SharedTaskStatus, childStatuses)) {
        const policy = deriveParentStatusPolicy(childStatuses)
        throw new ValidationError(
          `現在の子タスク状態ではステータスは次のいずれかです: ${policy.allowedStatuses.join('、')}`,
          { status: `許可: ${policy.allowedStatuses.join(', ')}` },
        )
      }
    }
  }

  // 明示的に更新フィールドを組み立て（スプレッドだと意図しないキーが混ざるのを避ける）
  const updates: Parameters<typeof repository.updateTask>[1] = {}

  if (parsed.data.title !== undefined) updates.title = parsed.data.title
  if (parsed.data.description !== undefined) updates.description = parsed.data.description
  if (parsed.data.status !== undefined) updates.status = parsed.data.status
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority
  if (parsed.data.requirement !== undefined) updates.requirement = parsed.data.requirement
  if (parsed.data.completionPercent !== undefined) {
    updates.completionPercent = clampCompletion(parsed.data.completionPercent)
  }
  if (parsed.data.estimatedEffortDays !== undefined) {
    updates.estimatedEffortDays =
      parsed.data.estimatedEffortDays === null ? null : parsed.data.estimatedEffortDays
  }
  if (parsed.data.actualEffortDays !== undefined) {
    updates.actualEffortDays =
      parsed.data.actualEffortDays === null ? null : parsed.data.actualEffortDays
  }
  const plannedStart = optionalDateUpdate(parsed.data.plannedStartDate)
  if (plannedStart !== undefined) {
    updates.plannedStartDate = plannedStart
    // 旧 startDate も合わせて消す（新規は plannedStartDate のみ）
    updates.startDate = null
  }
  const plannedDue = optionalDateUpdate(parsed.data.plannedDueDate)
  if (plannedDue !== undefined) {
    updates.plannedDueDate = plannedDue
    // AssigneeIndex 互換: dueDate を plannedDueDate と同期
    updates.dueDate = plannedDue
  }
  const actualStart = optionalDateUpdate(parsed.data.actualStartDate)
  if (actualStart !== undefined) updates.actualStartDate = actualStart
  const actualDue = optionalDateUpdate(parsed.data.actualDueDate)
  if (actualDue !== undefined) updates.actualDueDate = actualDue

  // WBS フィールド
  if (parsed.data.wbsCode !== undefined) {
    updates.wbsCode =
      parsed.data.wbsCode === null || parsed.data.wbsCode === ''
        ? null
        : parsed.data.wbsCode
  }
  if (parsed.data.sortOrder !== undefined) {
    updates.sortOrder =
      parsed.data.sortOrder === null ? null : parsed.data.sortOrder
  }
  if (parsed.data.nodeType !== undefined) {
    updates.nodeType =
      parsed.data.nodeType === null ? null : parsed.data.nodeType
  }
  /** 親変更時に子孫の WBS も振り直すための新コード */
  let reparentNewWbsCode: string | null = null
  let reparentSimulatedTasks: Task[] | null = null

  if (parsed.data.parentTaskId !== undefined) {
    const nextParent =
      parsed.data.parentTaskId === '' || parsed.data.parentTaskId === null
        ? null
        : parsed.data.parentTaskId
    const prevParent = existing.parentTaskId || null
    if (nextParent) {
      if (!byId.has(nextParent)) {
        throw new ValidationError('親タスクが見つかりません', {
          parentTaskId: '同一プロジェクト内のタスクを指定してください',
        })
      }
      if (wouldCreateCycle(existing.taskId, nextParent, byId)) {
        throw new ValidationError('親タスクに自分の子孫は指定できません', {
          parentTaskId: '循環参照になります',
        })
      }
      if (exceedsMaxDepth(nextParent, byId, WBS_MAX_DEPTH)) {
        throw new ValidationError(
          `WBS の深さは ${WBS_MAX_DEPTH} 階層までです`,
          { parentTaskId: `最大 ${WBS_MAX_DEPTH} 階層` },
        )
      }
      // 自分の子孫を連れて深い階層へ移す場合の簡易チェック
      const selfDepthAfter = depthOfAfterMove(nextParent, byId)
      const subtreeHeight = maxDescendantDepth(existing.taskId, projectTasks)
      if (selfDepthAfter + subtreeHeight - 1 > WBS_MAX_DEPTH) {
        throw new ValidationError(
          `移動後の深さが ${WBS_MAX_DEPTH} 階層を超えます`,
          { parentTaskId: '子孫を含めると深すぎます' },
        )
      }
    }
    updates.parentTaskId = nextParent

    // 親が変わった（または初めて親を付けた）→ WBS を新親配下で採番し直す
    const parentChanged = (nextParent || null) !== (prevParent || null)
    if (parentChanged || !existing.wbsCode) {
      // 移動後の親子をシミュレートして番号を決める
      const simulated = projectTasks.map((t) =>
        t.taskId === existing.taskId
          ? {
              ...t,
              parentTaskId: nextParent ?? undefined,
            }
          : t,
      )
      // 親側に wbs が無ければ一覧補完と同様に仮採番（ensure 済み想定だが保険）
      let parentEntity = nextParent
        ? simulated.find((t) => t.taskId === nextParent)
        : null
      if (parentEntity && !parentEntity.wbsCode?.trim()) {
        const parentPatches = planMissingWbsCodes(simulated)
        for (const p of parentPatches) {
          const idx = simulated.findIndex((t) => t.taskId === p.taskId)
          if (idx >= 0) simulated[idx] = { ...simulated[idx]!, wbsCode: p.wbsCode }
        }
        parentEntity = nextParent
          ? simulated.find((t) => t.taskId === nextParent) ?? null
          : null
      }

      const explicitWbs =
        parsed.data.wbsCode !== undefined &&
        parsed.data.wbsCode !== null &&
        parsed.data.wbsCode !== ''
          ? parsed.data.wbsCode.trim()
          : null

      const newCode =
        explicitWbs ??
        nextWbsCode(simulated, parentEntity ?? null, existing.taskId)

      updates.wbsCode = newCode
      if (parsed.data.sortOrder === undefined) {
        updates.sortOrder = nextSortOrder(simulated, nextParent, existing.taskId)
      }
      reparentNewWbsCode = newCode
      reparentSimulatedTasks = simulated.map((t) =>
        t.taskId === existing.taskId ? { ...t, wbsCode: newCode } : t,
      )
    }
  } else if (
    // 親は触らないが WBS が空のまま → 現在の親配下で採番
    (parsed.data.wbsCode === undefined ||
      parsed.data.wbsCode === null ||
      parsed.data.wbsCode === '') &&
    !existing.wbsCode
  ) {
    const parentEntity = existing.parentTaskId
      ? byId.get(existing.parentTaskId)
      : null
    updates.wbsCode = nextWbsCode(
      projectTasks,
      parentEntity ?? null,
      existing.taskId,
    )
  }

  // 評価者
  if (parsed.data.reviewers !== undefined) {
    const reviewers = await normalizeReviewers(project, parsed.data.reviewers)
    if (reviewers.length === 0) {
      updates.reviewers = null
    } else {
      updates.reviewers = reviewers
    }
  }

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

  // 子のステータス変更などで祖先の親ステータスを同期
  await syncAncestorStatuses(existing.projectId, updated)

  // 親変更後: 子孫の WBS を新しい番号体系に合わせて振り直し
  if (reparentNewWbsCode && reparentSimulatedTasks) {
    const renumbers = renumberSubtreeCodes(
      existing.taskId,
      reparentNewWbsCode,
      reparentSimulatedTasks,
    )
    for (const r of renumbers) {
      if (r.taskId === existing.taskId) continue
      try {
        await repository.updateTask(r.taskId, { wbsCode: r.wbsCode })
      } catch {
        // 続行
      }
    }
  }

  const listed = (await repository.listTasksByProject(existing.projectId)).filter(
    (t) => !t.isDeleted,
  )
  // 一覧モックが古い場合でも、今回更新した行を優先
  let refreshed = [
    ...listed.filter((t) => t.taskId !== updated.taskId),
    updated,
  ]
  refreshed = await ensureWbsCodesPersisted(existing.projectId, refreshed)
  const enrichedAll = await enrichTaskAssignees(refreshed, existing.projectId)
  const withWbs = enrichWithWbs(enrichedAll)
  return withWbs.find((t) => t.taskId === taskId) ?? presentTask(updated)
}

/**
 * タスク更新後、祖先の status を子集合に合わせて DB 同期
 * - 子に進行中あり → 親は進行中
 * - 全完了 / 進行中なし → 親が許容外ならデフォルトへ寄せる
 */
async function syncAncestorStatuses(
  projectId: string,
  changed: Task,
): Promise<void> {
  let parentId = changed.parentTaskId
  if (!parentId) return

  const all = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  // 変更後の自分を反映
  const merged = all.map((t) => (t.taskId === changed.taskId ? changed : t))

  while (parentId) {
    const parent = merged.find((t) => t.taskId === parentId)
    if (!parent) break
    const kids = childrenOf(merged, parent.taskId)
    const childStatuses = kids.map((k) => {
      // 子が親なら既に同期済みの status を使う
      return k.status
    })
    const resolved = resolveParentStatus(parent.status, childStatuses)
    if (resolved.status !== parent.status) {
      await repository.updateTask(parent.taskId, { status: resolved.status })
      parent.status = resolved.status
    }
    // 担当者和集合も永続化
    const withRollup = enrichWithWbs(merged)
    const parentEnriched = withRollup.find((t) => t.taskId === parent.taskId)
    if (parentEnriched?.rollup?.assignees) {
      const assignees = parentEnriched.rollup.assignees
      const primary = assignees[0]
      await repository.updateTask(parent.taskId, {
        assignees,
        assigneeId: primary?.userId,
        assigneeName: primary?.displayName,
        clearAssignees: assignees.length === 0 || !primary?.userId,
      })
    }
    parentId = parent.parentTaskId
  }
}

function depthOfAfterMove(
  newParentId: string,
  byId: Map<string, Task>,
): number {
  // 親の depth + 1
  let depth = 1
  let cur = byId.get(newParentId)
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.taskId)) break
    seen.add(cur.taskId)
    depth += 1
    if (!cur.parentTaskId) break
    cur = byId.get(cur.parentTaskId)
  }
  return depth
}

function maxDescendantDepth(rootId: string, tasks: Task[]): number {
  // 自身を 1 とした部分木の高さ
  const kids = tasks.filter((t) => !t.isDeleted && t.parentTaskId === rootId)
  if (!kids.length) return 1
  return 1 + Math.max(...kids.map((k) => maxDescendantDepth(k.taskId, tasks)))
}

/** タスクのステータスのみを更新する（かんばんドラッグ専用・リーフのみ） */
export async function updateTaskStatus(
  taskId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task> {
  const existing = await getAccessibleTask(taskId, userId, email)

  const projectTasks = (await repository.listTasksByProject(existing.projectId)).filter(
    (t) => !t.isDeleted,
  )
  const directChildren = projectTasks.filter((t) => t.parentTaskId === taskId)
  const hasChildren = directChildren.length > 0

  const parsed = updateStatusSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError(
      `ステータスは次のいずれかを指定してください: ${TASK_STATUSES.join('、')}`,
      { status: `許可値: ${TASK_STATUSES.join(', ')}` },
    )
  }

  const status = parsed.data.status as TaskStatus

  // かんばん専用: 子がある親は status 変更不可（詳細 update のポリシーで変更）
  if (hasChildren) {
    throw new ValidationError(
      '子タスクがある親は、かんばんからステータスを変更できません',
      { status: '子から集計されます。子タスクを編集するか、詳細から許可された候補を選んでください' },
    )
  }

  // かんばん: 完了→100% / 未着手→0%。レビュー待ち・保留は完了度を触らない
  let updated: Task
  if (status === '完了') {
    updated = await repository.updateTask(taskId, { status, completionPercent: 100 })
  } else if (status === '未着手') {
    updated = await repository.updateTask(taskId, { status, completionPercent: 0 })
  } else {
    updated = await repository.updateTask(taskId, { status })
  }

  await syncAncestorStatuses(existing.projectId, updated)

  const refreshed = (await repository.listTasksByProject(existing.projectId)).filter(
    (t) => !t.isDeleted,
  )
  const enrichedAll = await enrichTaskAssignees(
    refreshed.map((t) => (t.taskId === updated.taskId ? updated : t)),
    existing.projectId,
  )
  const withWbs = enrichWithWbs(enrichedAll)
  return withWbs.find((t) => t.taskId === taskId) ?? presentTask(updated)
}

/** タスクを論理削除する（子孫も連鎖論理削除） */
export async function deleteTask(
  taskId: string,
  userId: string,
  email?: string,
): Promise<Task> {
  const existing = await getAccessibleTask(taskId, userId, email)
  const projectTasks = await repository.listTasksByProject(existing.projectId)
  const descendantIds = collectDescendantIds(taskId, projectTasks)
  // 子孫を先に削除し、最後に自身
  for (const id of descendantIds) {
    await repository.softDeleteTask(id)
  }
  return repository.softDeleteTask(taskId)
}

// ─── WBS 構造 API（Phase 2 準備）────────────────────────────────

/**
 * POST /tasks/{parentTaskId}/children
 * 指定親の直下に子タスクを作成（createTask の親固定ショートカット）
 */
export async function createChildTask(
  parentTaskId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task> {
  const parent = await getAccessibleTask(parentTaskId, userId, email)
  const raw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>) }
      : {}
  // 親はパスで確定（body の parentTaskId は上書き）
  raw.parentTaskId = parent.taskId
  return createTask(parent.projectId, userId, raw, email)
}

/**
 * POST /tasks/{taskId}/move
 * body: { newParentId: string | null, sortOrder?: number }
 * 親変更・並び替え。環・深さ・子孫 WBS 振り直しは updateTask と同等。
 */
export async function moveTask(
  taskId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task> {
  const parsed = moveTaskSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }
  const newParentId =
    parsed.data.newParentId === '' || parsed.data.newParentId === null
      ? null
      : parsed.data.newParentId

  const payload: Record<string, unknown> = {
    parentTaskId: newParentId,
  }
  if (parsed.data.sortOrder !== undefined) {
    payload.sortOrder = parsed.data.sortOrder
  }
  return updateTask(taskId, userId, payload, email)
}

/**
 * POST /projects/{projectId}/tasks/reorder
 * 同一親下の sortOrder を一括更新。WBS 番号は変更しない（必要なら renumber を呼ぶ）。
 */
export async function reorderSiblingTasks(
  projectId: string,
  userId: string,
  body: unknown,
  email?: string,
): Promise<Task[]> {
  await assertProjectAccess(projectId, userId, email)
  const parsed = reorderTasksSchema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError('入力内容をご確認ください', toValidationFields(parsed.error))
  }

  const parentKey =
    parsed.data.parentTaskId === undefined ||
    parsed.data.parentTaskId === null ||
    parsed.data.parentTaskId === ''
      ? null
      : parsed.data.parentTaskId

  let projectTasks = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  const byId = buildById(projectTasks)

  if (parentKey && !byId.has(parentKey)) {
    throw new ValidationError('親タスクが見つかりません', {
      parentTaskId: '同一プロジェクト内のタスクを指定してください',
    })
  }

  const seen = new Set<string>()
  for (const item of parsed.data.items) {
    if (seen.has(item.taskId)) {
      throw new ValidationError('並べ替えリストに重複があります', {
        items: `重複: ${item.taskId}`,
      })
    }
    seen.add(item.taskId)
    const task = byId.get(item.taskId)
    if (!task) {
      throw new ValidationError('タスクが見つかりません', {
        items: `不明な taskId: ${item.taskId}`,
      })
    }
    if (task.projectId !== projectId) {
      throw new ValidationError('他プロジェクトのタスクは並べ替えできません', {
        items: item.taskId,
      })
    }
    const taskParent = task.parentTaskId || null
    if (taskParent !== parentKey) {
      throw new ValidationError('同一親の子だけを並べ替えできます', {
        items: `${item.taskId} の親が一致しません`,
      })
    }
  }

  for (const item of parsed.data.items) {
    await repository.updateTask(item.taskId, { sortOrder: item.sortOrder })
  }

  return listTasksByProject(projectId, userId, email)
}

/**
 * POST /projects/{projectId}/wbs/renumber
 * 現在の親子・sortOrder に基づきプロジェクト内の wbsCode を全振り直し。
 * sortOrder も兄弟内 0..n-1 に正規化する。
 */
export async function renumberProjectWbs(
  projectId: string,
  userId: string,
  email?: string,
): Promise<Task[]> {
  await assertProjectAccess(projectId, userId, email)
  let projectTasks = (await repository.listTasksByProject(projectId)).filter((t) => !t.isDeleted)
  // 欠落番号がある状態でも親子順で振り直す
  const patches = planFullWbsRenumber(projectTasks)

  for (const p of patches) {
    const cur = projectTasks.find((t) => t.taskId === p.taskId)
    if (!cur) continue
    if (cur.wbsCode === p.wbsCode && (cur.sortOrder ?? 0) === p.sortOrder) continue
    try {
      await repository.updateTask(p.taskId, {
        wbsCode: p.wbsCode,
        sortOrder: p.sortOrder,
      })
    } catch {
      // 続行
    }
  }

  return listTasksByProject(projectId, userId, email)
}
