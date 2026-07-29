import * as projectService from '../projects/service.js'
import * as taskRepository from '../tasks/repository.js'
import * as usersService from '../users/service.js'
import {
  TASK_STATUSES,
  type DashboardTask,
  type DashboardWbsPathItem,
  type ProjectSummary,
  type Task,
} from '../shared/types.js'
import { enrichWithWbs } from '../tasks/wbs.js'

function roundEffort(value: number): number {
  return Math.round(value * 10) / 10
}

function normalizedCompletion(task: Task): number {
  const value = Number(task.completionPercent ?? 0)
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

function isLeaf(task: Task): boolean {
  return (task.childCount ?? 0) === 0
}

function dateOnly(value?: string): string | undefined {
  return value?.slice(0, 10) || undefined
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function isScheduleAlertTarget(task: Task): boolean {
  return !['完了', 'レビュー待ち', '保留'].includes(task.status)
}

function buildWbsPath(task: Task, all: Task[]): DashboardWbsPathItem[] {
  const byId = new Map(all.map((item) => [item.taskId, item]))
  const path: DashboardWbsPathItem[] = []
  const seen = new Set<string>()
  let current = task.parentTaskId ? byId.get(task.parentTaskId) : undefined
  while (current && !seen.has(current.taskId)) {
    seen.add(current.taskId)
    path.unshift({
      taskId: current.taskId,
      wbsCode: current.wbsCode,
      title: current.title,
    })
    current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined
  }
  return path
}

function toDashboardTask(task: Task, all: Task[], projectName: string): DashboardTask {
  return {
    ...task,
    projectName,
    wbsPath: buildWbsPath(task, all),
  }
}

/** ダッシュボード用のプロジェクト横断統計を取得する */
export async function getSummary(
  userId: string,
  email?: string,
  name?: string,
): Promise<ProjectSummary[]> {
  const projects = await projectService.listProjects({
    userId,
    email,
    name: name || email || 'ユーザー',
  })

  const summaries = await Promise.all(
    projects.map(async (project) => {
      const rawTasks = (await taskRepository.listTasksByProject(project.projectId)).filter(
        (task) => !task.isDeleted,
      )
      const tasks = enrichWithWbs(rawTasks)
      const leafTasks = tasks.filter(isLeaf)

      const tasksByStatus: Record<string, number> = {}
      for (const status of TASK_STATUSES) {
        tasksByStatus[status] = 0
      }
      for (const task of leafTasks) {
        tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1
      }

      // 更新日 = タスクの最新 updatedAt（無ければプロジェクト updatedAt）
      let lastUpdatedAt = project.updatedAt
      for (const t of rawTasks) {
        if (t.updatedAt && t.updatedAt > lastUpdatedAt) {
          lastUpdatedAt = t.updatedAt
        }
      }

      const memberCount =
        project.members?.length ||
        project.memberIds?.length ||
        1

      let estimatedEffortDays = 0
      let actualEffortDays = 0
      let weightedCompletion = 0
      let weightedEffort = 0
      let simpleCompletion = 0
      const plannedStarts: string[] = []
      const plannedDues: string[] = []
      const today = todayDate()
      const dueSoonLimit = addUtcDays(today, 7)
      let overdueTaskCount = 0
      let dueSoonTaskCount = 0

      for (const task of leafTasks) {
        const estimated = Math.max(0, Number(task.estimatedEffortDays ?? 0))
        const actual = Math.max(0, Number(task.actualEffortDays ?? 0))
        const completion = normalizedCompletion(task)
        estimatedEffortDays += Number.isFinite(estimated) ? estimated : 0
        actualEffortDays += Number.isFinite(actual) ? actual : 0
        simpleCompletion += completion
        if (estimated > 0 && Number.isFinite(estimated)) {
          weightedCompletion += estimated * completion
          weightedEffort += estimated
        }
        const start = dateOnly(task.plannedStartDate ?? task.startDate)
        const due = dateOnly(task.plannedDueDate ?? task.dueDate)
        if (start) plannedStarts.push(start)
        if (due) plannedDues.push(due)
        if (due && isScheduleAlertTarget(task)) {
          if (due < today) overdueTaskCount += 1
          else if (due <= dueSoonLimit) dueSoonTaskCount += 1
        }
      }

      plannedStarts.sort()
      plannedDues.sort()
      const completionPercent =
        weightedEffort > 0
          ? Math.round(weightedCompletion / weightedEffort)
          : leafTasks.length > 0
            ? Math.round(simpleCompletion / leafTasks.length)
            : 0

      return {
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        memberCount,
        lastUpdatedAt,
        totalTasks: leafTasks.length,
        tasksByStatus,
        totalNodeCount: tasks.length,
        rootTaskCount: tasks.filter((task) => !task.parentTaskId).length,
        leafTaskCount: leafTasks.length,
        summaryTaskCount: tasks.length - leafTasks.length,
        leafTasksByStatus: { ...tasksByStatus },
        completionPercent,
        estimatedEffortDays: roundEffort(estimatedEffortDays),
        actualEffortDays: roundEffort(actualEffortDays),
        plannedStartDate: plannedStarts[0],
        plannedDueDate: plannedDues.at(-1),
        overdueTaskCount,
        dueSoonTaskCount,
        reviewTaskCount: tasksByStatus['レビュー待ち'] ?? 0,
      }
    }),
  )

  return summaries
}

/** タスクが指定ユーザーの担当か（複数担当・旧データ対応） */
function isAssignedToUser(
  t: Task,
  userId: string,
  nameCandidates: Set<string>,
): boolean {
  if (t.assigneeId === userId) return true
  if (t.assignees?.some((a) => a.userId === userId)) return true
  // 古いデータ: assigneeId 無し・名前のみ
  if (!t.assigneeId && t.assigneeName) {
    if (nameCandidates.has(t.assigneeName.trim().toLowerCase())) return true
  }
  if (t.assignees?.some((a) => {
    if (a.userId) return false
    return nameCandidates.has(a.displayName.trim().toLowerCase())
  })) {
    return true
  }
  return false
}

/** タスクの評価者に指定ユーザーが含まれるか */
function isReviewerOfTask(
  t: Task,
  userId: string,
  nameCandidates: Set<string>,
): boolean {
  const list = t.reviewers ?? []
  if (list.length === 0) return false
  for (const r of list) {
    if (r.userId === userId) return true
    if (!r.userId && r.displayName) {
      if (nameCandidates.has(r.displayName.trim().toLowerCase())) return true
    }
  }
  return false
}

async function buildNameCandidates(
  userId: string,
  email?: string,
  name?: string,
): Promise<Set<string>> {
  const displayName = await usersService.getDisplayName(userId)
  return new Set(
    [displayName, name, email?.split('@')[0]]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase()),
  )
}

/** 担当者・評価者名をクラウド表示名で上書き */
async function enrichPeopleNames<T extends Task>(tasks: T[]): Promise<T[]> {
  const ids = tasks.flatMap((t) => {
    const list = [
      t.assigneeId,
      ...(t.assignees?.map((a) => a.userId) ?? []),
      ...(t.reviewers?.map((r) => r.userId) ?? []),
    ]
    return list.filter(Boolean) as string[]
  })
  if (ids.length === 0) return tasks
  const names = await usersService.getDisplayNameMap(ids)
  if (names.size === 0) return tasks
  return tasks.map((t) => {
    const assignees = (t.assignees ?? []).map((a) =>
      a.userId && names.has(a.userId)
        ? { ...a, displayName: names.get(a.userId)! }
        : a,
    )
    const reviewers = (t.reviewers ?? []).map((r) =>
      r.userId && names.has(r.userId)
        ? { ...r, displayName: names.get(r.userId)! }
        : r,
    )
    const primaryName =
      t.assigneeId && names.has(t.assigneeId)
        ? names.get(t.assigneeId)!
        : t.assigneeName
    return {
      ...t,
      assignees: assignees.length > 0 ? assignees : t.assignees,
      reviewers: reviewers.length > 0 ? reviewers : t.reviewers,
      assigneeName: primaryName,
    }
  })
}

/**
 * 自分が担当する未完了タスクを締切日昇順で取得する
 *
 * 判定ロジック:
 * 1. 主: assigneeId === ログインユーザー（AssigneeIndex・主担当）
 * 2. 補: assignees[] に userId が含まれる（副担当）
 * 3. 補: 古いデータで名前のみ一致
 * 4. アクセス可能なプロジェクトのタスクのみ
 */
export async function getMyTasks(
  userId: string,
  email?: string,
  name?: string,
): Promise<DashboardTask[]> {
  // アクセス可能なプロジェクトを先に確定（フィルタの基準）
  const projects = await projectService.listProjects({
    userId,
    email,
    name: name || email || 'ユーザー',
  })
  const accessibleProjectIds = new Set(projects.map((p) => p.projectId))

  const byId = await taskRepository.listTasksByAssignee(userId)
  const nameCandidates = await buildNameCandidates(userId, email, name)

  // プロジェクト横断: 副担当・名前のみ一致も拾う
  const projectTasks = (
    await Promise.all(
      projects.map((p) => taskRepository.listTasksByProject(p.projectId)),
    )
  ).flat()

  const projectNameById = new Map(projects.map((project) => [project.projectId, project.name]))
  const sourceById = new Map<string, Task>()
  for (const task of [...projectTasks, ...byId]) {
    if (!accessibleProjectIds.has(task.projectId) || task.isDeleted) continue
    sourceById.set(task.taskId, task)
  }

  const dashboardTasks: DashboardTask[] = []
  for (const project of projects) {
    const projectSource = Array.from(sourceById.values()).filter(
      (task) => task.projectId === project.projectId,
    )
    const enriched = enrichWithWbs(projectSource)
    for (const task of enriched) {
      if (!isLeaf(task) || task.status === '完了') continue
      if (!isAssignedToUser(task, userId, nameCandidates)) continue
      dashboardTasks.push(
        toDashboardTask(
          task,
          enriched,
          projectNameById.get(task.projectId) ?? project.name,
        ),
      )
    }
  }

  const tasks = dashboardTasks.sort((a, b) => {
    const aDue = a.plannedDueDate ?? a.dueDate
    const bDue = b.plannedDueDate ?? b.dueDate
    if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue)
    if (!aDue && bDue) return 1
    if (aDue && !bDue) return -1
    const byProject = a.projectName.localeCompare(b.projectName, 'ja')
    if (byProject !== 0) return byProject
    return (a.wbsCode ?? a.title).localeCompare(b.wbsCode ?? b.title, 'ja', {
      numeric: true,
    })
  })

  return enrichPeopleNames(tasks)
}

/**
 * 自分が評価者に指定されている「レビュー待ち」タスク
 * ダッシュボード「評価待ち」欄用
 */
export async function getMyReviewTasks(
  userId: string,
  email?: string,
  name?: string,
): Promise<DashboardTask[]> {
  const projects = await projectService.listProjects({
    userId,
    email,
    name: name || email || 'ユーザー',
  })
  const nameCandidates = await buildNameCandidates(userId, email, name)

  const projectTasks = (
    await Promise.all(
      projects.map((p) => taskRepository.listTasksByProject(p.projectId)),
    )
  ).flat()

  const projectNameById = new Map(projects.map((project) => [project.projectId, project.name]))
  const tasks = projects
    .flatMap((project) => {
      const enriched = enrichWithWbs(
        projectTasks.filter(
          (task) => task.projectId === project.projectId && !task.isDeleted,
        ),
      )
      return enriched
        .filter((task) => {
          if (!isLeaf(task)) return false
          if (task.status !== 'レビュー待ち') return false
          return isReviewerOfTask(task, userId, nameCandidates)
        })
        .map((task) =>
          toDashboardTask(
            task,
            enriched,
            projectNameById.get(task.projectId) ?? project.name,
          ),
        )
    })
    .sort((a, b) => {
      // 更新が新しい順（評価を急ぐものを上に）
      return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    })

  return enrichPeopleNames(tasks)
}
