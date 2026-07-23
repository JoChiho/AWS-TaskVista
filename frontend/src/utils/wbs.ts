/**
 * WBS 表示・集計ヘルパー（親子・リーフ・ロールアップ・パンくず）
 */
import type {
  ParentStatusMode,
  Task,
  TaskAssignee,
  TaskRollup,
  TaskStatus,
} from '@/types/task'

export function activeTasksList(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.isDeleted)
}

export function parentKey(task: Task): string {
  return task.parentTaskId || ''
}

export type WbsSortOrder = 'asc' | 'desc'

/** WBS 番号の自然順比較（1 < 1.2 < 2、欠落は末尾） */
export function compareWbsCode(a?: string | null, b?: string | null): number {
  const aa = a?.trim() || ''
  const bb = b?.trim() || ''
  if (!aa && !bb) return 0
  if (!aa) return 1
  if (!bb) return -1
  return aa.localeCompare(bb, undefined, { numeric: true, sensitivity: 'base' })
}

export function childrenOf(
  tasks: Task[],
  parentId: string | null | undefined,
  wbsOrder: WbsSortOrder = 'asc',
): Task[] {
  const key = parentId || ''
  const dir = wbsOrder === 'asc' ? 1 : -1
  return activeTasksList(tasks)
    .filter((t) => parentKey(t) === key)
    .sort((a, b) => {
      const byWbs = compareWbsCode(a.wbsCode, b.wbsCode)
      if (byWbs !== 0) return byWbs * dir
      const ao = a.sortOrder ?? 0
      const bo = b.sortOrder ?? 0
      if (ao !== bo) return (ao - bo) * dir
      return (a.createdAt || '').localeCompare(b.createdAt || '') * dir
    })
}

/** 子の有無（childCount または実際の親子関係から） */
export function hasChildren(task: Task, all?: Task[]): boolean {
  if (task.childCount && task.childCount > 0) return true
  if (!all) return false
  return activeTasksList(all).some((t) => t.parentTaskId === task.taskId)
}

export function isLeafTask(task: Task, all?: Task[]): boolean {
  return !hasChildren(task, all)
}

export function isParentTask(task: Task, all?: Task[]): boolean {
  return hasChildren(task, all)
}

export function filterLeafTasks(tasks: Task[]): Task[] {
  return activeTasksList(tasks).filter((t) => isLeafTask(t, tasks))
}

/**
 * かんばん表示範囲
 * - leaf: 最小単位（子のないタスク）のみ
 * - level: 指定階層のみ（1=第1層 … 3=第3層）
 * - all: 全タスク
 */
export type KanbanScopeMode = 'leaf' | 'level' | 'all'

export function matchesKanbanScope(
  task: Task,
  all: Task[],
  mode: KanbanScopeMode,
  level: 1 | 2 | 3 = 1,
): boolean {
  if (task.isDeleted) return false
  if (mode === 'all') return true
  if (mode === 'leaf') return isLeafTask(task, all)
  // level: depth 0 → 第1層
  const depth = depthOfTask(task, all)
  return depth === level - 1
}

export function breadcrumbPath(task: Task, all: Task[]): Task[] {
  const byId = new Map(all.map((t) => [t.taskId, t]))
  const path: Task[] = []
  let cur: Task | undefined = task
  const seen = new Set<string>()
  while (cur) {
    if (seen.has(cur.taskId)) break
    seen.add(cur.taskId)
    path.unshift(cur)
    cur = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined
  }
  return path
}

export function depthOfTask(task: Task, all: Task[]): number {
  return Math.max(0, breadcrumbPath(task, all).length - 1)
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

function minDate(values: string[]): string | undefined {
  if (!values.length) return undefined
  return values.map((d) => d.slice(0, 10)).sort()[0]
}

function maxDate(values: string[]): string | undefined {
  if (!values.length) return undefined
  return values.map((d) => d.slice(0, 10)).sort().at(-1)
}

function depthOf(taskId: string, byId: Map<string, Task>): number {
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

export function deriveParentStatusPolicy(childStatuses: TaskStatus[]): {
  mode: ParentStatusMode
  allowedStatuses: TaskStatus[]
  forcedStatus?: TaskStatus
  defaultStatus: TaskStatus
} {
  if (childStatuses.some((s) => s === '進行中')) {
    return {
      mode: 'forced_progress',
      allowedStatuses: ['進行中'],
      forcedStatus: '進行中',
      defaultStatus: '進行中',
    }
  }
  if (childStatuses.length > 0 && childStatuses.every((s) => s === '完了')) {
    return {
      mode: 'all_done_choice',
      allowedStatuses: ['完了', 'レビュー待ち'],
      defaultStatus: '完了',
    }
  }
  return {
    mode: 'idle_choice',
    allowedStatuses: ['未着手', '保留'],
    defaultStatus: '未着手',
  }
}

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

/**
 * 欠落 wbsCode を親子関係から補完（表示・クライアント再計算用）
 */
export function planMissingWbsCodes(
  tasks: Task[],
): Array<{ taskId: string; wbsCode: string }> {
  const active = activeTasksList(tasks)
  const patches: Array<{ taskId: string; wbsCode: string }> = []
  const assigned = new Map<string, string>()

  for (const t of active) {
    if (t.wbsCode?.trim()) assigned.set(t.taskId, t.wbsCode.trim())
  }

  function walk(parentId: string | null, parentCode: string | null) {
    const kids = childrenOf(active, parentId)
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

/**
 * 全タスクに childCount / rollup / 欠落 WBS を付け直す（クライアント即時反映用）
 * 子がいる親は必ず rollup を持ち、表示は displaySchedule 経由で集計値を使う
 */
export function enrichWithWbs(tasks: Task[]): Task[] {
  // 先に欠落 WBS を埋めた作業コピー
  const codePatches = planMissingWbsCodes(tasks)
  const codeMap = new Map(codePatches.map((p) => [p.taskId, p.wbsCode]))
  const withCodes = tasks.map((t) =>
    codeMap.has(t.taskId) ? { ...t, wbsCode: codeMap.get(t.taskId) } : t,
  )

  const active = activeTasksList(withCodes)
  const byId = new Map(active.map((t) => [t.taskId, t]))

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

  return withCodes.map((t) => {
    if (t.isDeleted) {
      const { rollup: _r, childCount: _c, ...rest } = t
      return { ...rest, childCount: 0 }
    }
    const childCount = childCountMap.get(t.taskId) ?? 0
    const rollup = rollupMap.get(t.taskId)
    const base = {
      ...t,
      childCount,
      nodeType: t.nodeType ?? ('work_package' as const),
      status: rollup ? rollup.status : t.status,
    }
    if (rollup) {
      return {
        ...base,
        rollup,
        assignees: rollup.assignees,
        assigneeId: rollup.assignees[0]?.userId,
        assigneeName: rollup.assignees[0]?.displayName,
      }
    }
    const { rollup: _old, ...without } = base
    return without
  })
}

/**
 * 親の日程・工数・進捗の表示用値
 * 子あり → 必ず rollup（無ければ 0）
 * 子なし → 自身の手入力値
 */
export function displaySchedule(task: Task): {
  plannedStartDate?: string
  plannedDueDate?: string
  actualStartDate?: string
  actualDueDate?: string
  estimatedEffortDays?: number
  actualEffortDays?: number
  completionPercent: number
  isRollup: boolean
} {
  if ((task.childCount ?? 0) > 0) {
    const r = task.rollup
    return {
      plannedStartDate: r?.plannedStartDate,
      plannedDueDate: r?.plannedDueDate,
      actualStartDate: r?.actualStartDate,
      actualDueDate: r?.actualDueDate,
      estimatedEffortDays:
        r?.estimatedEffortDaysSum != null
          ? roundEffort1(r.estimatedEffortDaysSum)
          : undefined,
      actualEffortDays:
        r?.actualEffortDaysSum != null
          ? roundEffort1(r.actualEffortDaysSum)
          : undefined,
      completionPercent: r?.completionPercent ?? 0,
      isRollup: true,
    }
  }
  return {
    plannedStartDate: task.plannedStartDate ?? task.startDate,
    plannedDueDate: task.plannedDueDate ?? task.dueDate,
    actualStartDate: task.actualStartDate,
    actualDueDate: task.actualDueDate,
    estimatedEffortDays:
      task.estimatedEffortDays != null
        ? roundEffort1(Number(task.estimatedEffortDays))
        : undefined,
    actualEffortDays:
      task.actualEffortDays != null
        ? roundEffort1(Number(task.actualEffortDays))
        : undefined,
    completionPercent: completionOf(task),
    isRollup: false,
  }
}

/** 親選択用オプション（自分と子孫を除外） */
export function parentOptions(
  tasks: Task[],
  excludeTaskId?: string,
): Array<{ title: string; value: string }> {
  const exclude = new Set<string>()
  if (excludeTaskId) {
    exclude.add(excludeTaskId)
    const stack = [excludeTaskId]
    while (stack.length) {
      const id = stack.pop()!
      for (const t of tasks) {
        if (!t.isDeleted && t.parentTaskId === id && !exclude.has(t.taskId)) {
          exclude.add(t.taskId)
          stack.push(t.taskId)
        }
      }
    }
  }
  return activeTasksList(tasks)
    .filter((t) => !exclude.has(t.taskId))
    .sort((a, b) =>
      (a.wbsCode || a.title).localeCompare(b.wbsCode || b.title, undefined, {
        numeric: true,
      }),
    )
    .map((t) => ({
      title: `${t.wbsCode ? t.wbsCode + ' ' : ''}${t.title}`,
      value: t.taskId,
    }))
}

/**
 * ツリー展開用: ルートから、expanded に含まれる親の子孫だけを深さ優先で並べる
 * 兄弟は WBS 昇順 / 降順（wbsOrder）
 */
export function flattenVisibleTree(
  tasks: Task[],
  expandedIds: Set<string>,
  wbsOrder: WbsSortOrder = 'asc',
): Task[] {
  const active = activeTasksList(tasks)
  const roots = childrenOf(active, null, wbsOrder)
  const out: Task[] = []

  function walk(nodes: Task[]) {
    for (const n of nodes) {
      out.push(n)
      if (expandedIds.has(n.taskId) && hasChildren(n, active)) {
        walk(childrenOf(active, n.taskId, wbsOrder))
      }
    }
  }

  walk(roots)
  return out
}
