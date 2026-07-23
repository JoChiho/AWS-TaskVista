/**
 * WBS（親子・深さ・集計・番号）の純粋ロジック
 */
import type {
  ParentStatusMode,
  Task,
  TaskAssignee,
  TaskNodeType,
  TaskRollup,
  TaskStatus,
} from '../shared/types.js'

/** L1〜L3 まで（ルート depth=1） */
export const WBS_MAX_DEPTH = 3

export const TASK_NODE_TYPES: readonly TaskNodeType[] = [
  'summary',
  'work_package',
  'milestone',
] as const

export function isTaskNodeType(v: unknown): v is TaskNodeType {
  return TASK_NODE_TYPES.includes(v as TaskNodeType)
}

export function activeTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.isDeleted)
}

export function parentKey(task: Task): string {
  return task.parentTaskId || ''
}

export function childrenOf(tasks: Task[], parentId: string | null | undefined): Task[] {
  const key = parentId || ''
  return activeTasks(tasks)
    .filter((t) => parentKey(t) === key)
    .sort((a, b) => {
      const ao = a.sortOrder ?? 0
      const bo = b.sortOrder ?? 0
      if (ao !== bo) return ao - bo
      return (a.createdAt || '').localeCompare(b.createdAt || '')
    })
}

/** ルートから数えた深さ（ルート=1） */
export function depthOf(taskId: string, byId: Map<string, Task>): number {
  let depth = 0
  let cur: Task | undefined = byId.get(taskId)
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.taskId)) return Math.max(depth, 1)
    seen.add(cur.taskId)
    depth += 1
    if (!cur.parentTaskId) break
    cur = byId.get(cur.parentTaskId)
  }
  return depth || 1
}

export function buildById(tasks: Task[]): Map<string, Task> {
  const m = new Map<string, Task>()
  for (const t of tasks) m.set(t.taskId, t)
  return m
}

export function wouldCreateCycle(
  taskId: string,
  candidateParentId: string,
  byId: Map<string, Task>,
): boolean {
  if (taskId === candidateParentId) return true
  let cur: Task | undefined = byId.get(candidateParentId)
  const seen = new Set<string>()
  while (cur) {
    if (cur.taskId === taskId) return true
    if (seen.has(cur.taskId)) return true
    seen.add(cur.taskId)
    if (!cur.parentTaskId) break
    cur = byId.get(cur.parentTaskId)
  }
  return false
}

export function collectDescendantIds(rootId: string, tasks: Task[]): string[] {
  const byParent = new Map<string, Task[]>()
  for (const t of activeTasks(tasks)) {
    const k = parentKey(t)
    const list = byParent.get(k) ?? []
    list.push(t)
    byParent.set(k, list)
  }
  const out: string[] = []
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    const kids = byParent.get(id) ?? []
    for (const k of kids) {
      out.push(k.taskId)
      stack.push(k.taskId)
    }
  }
  return out
}

function minDate(values: string[]): string | undefined {
  if (!values.length) return undefined
  return values.map((d) => d.slice(0, 10)).sort()[0]
}

function maxDate(values: string[]): string | undefined {
  if (!values.length) return undefined
  return values.map((d) => d.slice(0, 10)).sort().at(-1)
}

function effortOf(t: Task, key: 'estimatedEffortDays' | 'actualEffortDays'): number {
  const v = t[key]
  if (v == null || Number.isNaN(Number(v))) return 0
  return Math.max(0, Number(v))
}

/** 工数は単純合計。浮動小数のゴミを避け小数第 1 位まで */
function roundEffort1(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, n) * 10) / 10
}

function completionOf(t: Task): number {
  if (t.completionPercent == null || Number.isNaN(Number(t.completionPercent))) return 0
  return Math.min(100, Math.max(0, Math.round(Number(t.completionPercent))))
}

/**
 * 子の有効ステータスから親の制約を決める
 *
 * - 全完了 → 完了 / レビュー待ちを選択可
 * - 全未着手 → 未着手 / 保留
 * - 全保留 → 保留 / 未着手
 * - それ以外（進行中・レビュー待ち・完了と未着手の混在など「途中」）
 *   → 親は必ず進行中（進捗 0〜99 と整合）
 */
export function deriveParentStatusPolicy(childStatuses: TaskStatus[]): {
  mode: ParentStatusMode
  allowedStatuses: TaskStatus[]
  forcedStatus?: TaskStatus
  defaultStatus: TaskStatus
} {
  if (childStatuses.length === 0) {
    return {
      mode: 'idle_choice',
      allowedStatuses: ['未着手', '保留'],
      defaultStatus: '未着手',
    }
  }

  // すべて完了
  if (childStatuses.every((s) => s === '完了')) {
    return {
      mode: 'all_done_choice',
      allowedStatuses: ['完了', 'レビュー待ち'],
      defaultStatus: '完了',
    }
  }

  // すべて未着手のみ（まだ何も進んでいない）
  if (childStatuses.every((s) => s === '未着手')) {
    return {
      mode: 'idle_choice',
      allowedStatuses: ['未着手', '保留'],
      defaultStatus: '未着手',
    }
  }

  // すべて保留
  if (childStatuses.every((s) => s === '保留')) {
    return {
      mode: 'idle_choice',
      allowedStatuses: ['保留', '未着手'],
      defaultStatus: '保留',
    }
  }

  // 進行中 / レビュー待ち / 完了+未着手の混在 など「途中」
  // （例: 子が 完了 と 未着手 だけ → 親は進行中。旧ロジックは誤って未着手にしていた）
  return {
    mode: 'forced_progress',
    allowedStatuses: ['進行中'],
    forcedStatus: '進行中',
    defaultStatus: '進行中',
  }
}

/** 保存中の親 status を制約内に正規化 */
export function resolveParentStatus(
  stored: TaskStatus | undefined,
  childStatuses: TaskStatus[],
): { status: TaskStatus; mode: ParentStatusMode; allowedStatuses: TaskStatus[] } {
  const policy = deriveParentStatusPolicy(childStatuses)
  if (policy.forcedStatus) {
    return {
      status: policy.forcedStatus,
      mode: policy.mode,
      allowedStatuses: policy.allowedStatuses,
    }
  }
  const storedOk =
    stored && policy.allowedStatuses.includes(stored) ? stored : policy.defaultStatus
  return {
    status: storedOk,
    mode: policy.mode,
    allowedStatuses: policy.allowedStatuses,
  }
}

function assigneesFromTask(t: Task): TaskAssignee[] {
  if (t.rollup?.assignees?.length) return t.rollup.assignees
  if (t.assignees?.length) return t.assignees
  if (t.assigneeId || t.assigneeName) {
    return [
      {
        userId: t.assigneeId,
        displayName: t.assigneeName || 'ユーザー',
      },
    ]
  }
  return []
}

export function unionAssignees(lists: TaskAssignee[][]): TaskAssignee[] {
  const seen = new Set<string>()
  const out: TaskAssignee[] = []
  for (const list of lists) {
    for (const a of list) {
      const key = (a.userId || a.displayName).toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(a)
    }
  }
  return out
}

/** 子（必要なら rollup 済み）から親の rollup を計算 */
export function computeRollupFromChildren(
  children: Task[],
  parentStoredStatus?: TaskStatus,
): TaskRollup {
  let estimatedSum = 0
  let actualSum = 0
  let weightedCompletion = 0
  let weightTotal = 0
  let equalSum = 0
  const plannedStarts: string[] = []
  const plannedDues: string[] = []
  const actualStarts: string[] = []
  const actualDues: string[] = []
  const statuses: TaskStatus[] = []
  const assigneeLists: TaskAssignee[][] = []

  for (const c of children) {
    const est = c.rollup ? c.rollup.estimatedEffortDaysSum : effortOf(c, 'estimatedEffortDays')
    const act = c.rollup ? c.rollup.actualEffortDaysSum : effortOf(c, 'actualEffortDays')
    const comp = c.rollup ? c.rollup.completionPercent : completionOf(c)
    const st = c.rollup ? c.rollup.status : c.status
    const pStart = c.rollup?.plannedStartDate ?? c.plannedStartDate ?? c.startDate
    const pDue = c.rollup?.plannedDueDate ?? c.plannedDueDate ?? c.dueDate
    const aStart = c.rollup?.actualStartDate ?? c.actualStartDate
    const aDue = c.rollup?.actualDueDate ?? c.actualDueDate

    estimatedSum += est
    actualSum += act
    equalSum += comp
    statuses.push(st)
    assigneeLists.push(assigneesFromTask(c))
    if (est > 0) {
      weightedCompletion += comp * est
      weightTotal += est
    }
    if (pStart) plannedStarts.push(pStart)
    if (pDue) plannedDues.push(pDue)
    if (aStart) actualStarts.push(aStart)
    if (aDue) actualDues.push(aDue)
  }

  const completionPercent =
    weightTotal > 0
      ? Math.round(weightedCompletion / weightTotal)
      : children.length
        ? Math.round(equalSum / children.length)
        : 0

  const resolved = resolveParentStatus(parentStoredStatus, statuses)

  // 実績終了日: 子がすべて完了してから、子の実績終了の最遅日を採用
  // （一部の子だけ完了/実績終了がある段階では親に載せない）
  const allChildrenDone =
    statuses.length > 0 && statuses.every((s) => s === '完了')
  const rolledActualDue = allChildrenDone ? maxDate(actualDues) : undefined

  return {
    childCount: children.length,
    // 工数は加重平均ではなく単純合計（小数 1 位）
    estimatedEffortDaysSum: roundEffort1(estimatedSum),
    actualEffortDaysSum: roundEffort1(actualSum),
    // 進捗%は工数加重平均 → 整数（0〜100）
    completionPercent,
    plannedStartDate: minDate(plannedStarts),
    plannedDueDate: maxDate(plannedDues),
    actualStartDate: minDate(actualStarts),
    actualDueDate: rolledActualDue,
    status: resolved.status,
    statusMode: resolved.mode,
    allowedStatuses: resolved.allowedStatuses,
    assignees: unionAssignees(assigneeLists),
  }
}

/** プロジェクト内タスクへ childCount / rollup を付与 */
export function enrichWithWbs(tasks: Task[]): Task[] {
  const active = activeTasks(tasks)
  const byId = buildById(active)

  const ordered = [...active].sort(
    (a, b) => depthOf(b.taskId, byId) - depthOf(a.taskId, byId),
  )

  const rollupMap = new Map<string, TaskRollup>()
  const childCountMap = new Map<string, number>()

  for (const t of ordered) {
    const kids = childrenOf(active, t.taskId).map((k) => {
      const r = rollupMap.get(k.taskId)
      return r ? { ...k, rollup: r, childCount: r.childCount } : k
    })
    childCountMap.set(t.taskId, kids.length)
    if (kids.length > 0) {
      rollupMap.set(t.taskId, computeRollupFromChildren(kids, t.status))
    }
  }

  return tasks.map((t) => {
    if (t.isDeleted) return { ...t, childCount: 0 }
    const childCount = childCountMap.get(t.taskId) ?? 0
    const rollup = rollupMap.get(t.taskId)
    // 親の表示 status は rollup に合わせる（強制進行中など）
    const status = rollup ? rollup.status : t.status
    return {
      ...t,
      status,
      childCount,
      ...(rollup ? { rollup } : {}),
      nodeType: t.nodeType ?? 'work_package',
      sortOrder: t.sortOrder ?? 0,
      // 担当は子孫の和集合を表示用に載せ替え（永続は別途 cascade で更新可）
      ...(rollup?.assignees
        ? {
            assignees: rollup.assignees,
            assigneeId: rollup.assignees[0]?.userId,
            assigneeName: rollup.assignees[0]?.displayName,
          }
        : {}),
    }
  })
}

export function nextSortOrder(
  tasks: Task[],
  parentTaskId?: string | null,
  excludeTaskId?: string,
): number {
  const siblings = childrenOf(tasks, parentTaskId).filter(
    (s) => s.taskId !== excludeTaskId,
  )
  if (!siblings.length) return 0
  return Math.max(...siblings.map((s) => s.sortOrder ?? 0)) + 1
}

/**
 * 同一親下の次の WBS 番号
 * @param excludeTaskId 移動中の自分自身を兄弟カウントから外す
 */
export function nextWbsCode(
  tasks: Task[],
  parent: Task | null | undefined,
  excludeTaskId?: string,
): string {
  const siblings = childrenOf(tasks, parent?.taskId).filter(
    (s) => s.taskId !== excludeTaskId,
  )
  if (!parent) {
    let max = 0
    for (const s of siblings) {
      const code = s.wbsCode || ''
      const m = /^(\d+)/.exec(code)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return String(max + 1)
  }
  const base = parent.wbsCode?.trim() || '1'
  let max = 0
  const prefix = `${base}.`
  for (const s of siblings) {
    const code = s.wbsCode || ''
    if (code.startsWith(prefix)) {
      const rest = code.slice(prefix.length)
      const n = Number(rest.split('.')[0])
      if (!Number.isNaN(n)) max = Math.max(max, n)
    }
  }
  return `${base}.${max + 1}`
}

/**
 * 部分木の WBS を newRootCode を根として振り直す（根自身含む）
 * 子は sortOrder / 作成順で 1..n
 */
export function renumberSubtreeCodes(
  rootId: string,
  newRootCode: string,
  tasks: Task[],
): Array<{ taskId: string; wbsCode: string }> {
  const result: Array<{ taskId: string; wbsCode: string }> = [
    { taskId: rootId, wbsCode: newRootCode },
  ]
  const kids = childrenOf(tasks, rootId)
  kids.forEach((kid, index) => {
    const childCode = `${newRootCode}.${index + 1}`
    result.push(...renumberSubtreeCodes(kid.taskId, childCode, tasks))
  })
  return result
}

/**
 * プロジェクト全体の WBS を sortOrder / 作成順で 1, 1.1, 1.2, 2… と振り直す
 * （番号の一括振り直し API 用）
 */
export function planFullWbsRenumber(
  tasks: Task[],
): Array<{ taskId: string; wbsCode: string; sortOrder: number }> {
  const active = activeTasks(tasks)
  const result: Array<{ taskId: string; wbsCode: string; sortOrder: number }> = []

  function walk(parentId: string | null, parentCode: string | null) {
    const kids = childrenOf(active, parentId)
    kids.forEach((k, index) => {
      const sortOrder = index
      const wbsCode = parentCode ? `${parentCode}.${index + 1}` : String(index + 1)
      result.push({ taskId: k.taskId, wbsCode, sortOrder })
      walk(k.taskId, wbsCode)
    })
  }

  walk(null, null)
  return result
}

/**
 * 欠落している wbsCode を親子関係から補完するパッチ一覧
 * （後から親を付けた・WBS 導入前データ向け）
 */
export function planMissingWbsCodes(
  tasks: Task[],
): Array<{ taskId: string; wbsCode: string }> {
  const active = activeTasks(tasks)
  const patches: Array<{ taskId: string; wbsCode: string }> = []
  const assigned = new Map<string, string>()

  for (const t of active) {
    if (t.wbsCode?.trim()) assigned.set(t.taskId, t.wbsCode.trim())
  }

  function walk(parentId: string | null, parentCode: string | null) {
    const kids = childrenOf(active, parentId)
    // 既存番号から次の連番を決める
    let nextIndex = 1
    for (const k of kids) {
      const existing = assigned.get(k.taskId)
      if (!existing) continue
      if (parentCode) {
        const prefix = `${parentCode}.`
        if (existing.startsWith(prefix)) {
          const n = Number(existing.slice(prefix.length).split('.')[0])
          if (!Number.isNaN(n)) nextIndex = Math.max(nextIndex, n + 1)
        }
      } else {
        const n = Number(existing.split('.')[0])
        if (!Number.isNaN(n)) nextIndex = Math.max(nextIndex, n + 1)
      }
    }

    for (const k of kids) {
      let code = assigned.get(k.taskId)
      if (!code) {
        code = parentCode ? `${parentCode}.${nextIndex}` : String(nextIndex)
        nextIndex += 1
        patches.push({ taskId: k.taskId, wbsCode: code })
        assigned.set(k.taskId, code)
      }
      walk(k.taskId, code)
    }
  }

  walk(null, null)
  return patches
}

export function exceedsMaxDepth(
  parentId: string | null | undefined,
  byId: Map<string, Task>,
  maxDepth = WBS_MAX_DEPTH,
): boolean {
  if (!parentId) return false
  return depthOf(parentId, byId) + 1 > maxDepth
}

/** 親で手入力禁止: 進捗・予定/実績日程・工数・担当（和集合） */
export function touchesParentLockedFields(body: Record<string, unknown>): string[] {
  const locked = [
    'completionPercent',
    'estimatedEffortDays',
    'actualEffortDays',
    'plannedStartDate',
    'plannedDueDate',
    'actualStartDate',
    'actualDueDate',
    'assignees',
    'assigneeId',
    'assigneeName',
  ] as const
  return locked.filter((k) => body[k] !== undefined)
}

/** 親ステータス更新が許容モード内か */
export function isParentStatusAllowed(
  status: TaskStatus,
  childStatuses: TaskStatus[],
): boolean {
  return deriveParentStatusPolicy(childStatuses).allowedStatuses.includes(status)
}
