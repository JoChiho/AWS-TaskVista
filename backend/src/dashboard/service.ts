import * as projectService from '../projects/service.js'
import * as taskRepository from '../tasks/repository.js'
import * as usersService from '../users/service.js'
import { TASK_STATUSES, type ProjectSummary, type Task } from '../shared/types.js'

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
      const tasks = (await taskRepository.listTasksByProject(project.projectId)).filter(
        (t) => !t.isDeleted,
      )

      const tasksByStatus: Record<string, number> = {}
      for (const status of TASK_STATUSES) {
        tasksByStatus[status] = 0
      }
      for (const task of tasks) {
        tasksByStatus[task.status] = (tasksByStatus[task.status] ?? 0) + 1
      }

      // 更新日 = タスクの最新 updatedAt（無ければプロジェクト updatedAt）
      let lastUpdatedAt = project.updatedAt
      for (const t of tasks) {
        if (t.updatedAt && t.updatedAt > lastUpdatedAt) {
          lastUpdatedAt = t.updatedAt
        }
      }

      const memberCount =
        project.members?.length ||
        project.memberIds?.length ||
        1

      return {
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        memberCount,
        lastUpdatedAt,
        totalTasks: tasks.length,
        tasksByStatus,
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
async function enrichPeopleNames(tasks: Task[]): Promise<Task[]> {
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
): Promise<Task[]> {
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

  const byMatch = projectTasks.filter((t) => {
    if (t.isDeleted || t.status === '完了') return false
    return isAssignedToUser(t, userId, nameCandidates)
  })

  const map = new Map<string, Task>()
  for (const t of [...byId, ...byMatch]) {
    // プロジェクト権限が無いタスクはダッシュボードに出さない
    if (!accessibleProjectIds.has(t.projectId)) continue
    if (!t.isDeleted && t.status !== '完了') {
      map.set(t.taskId, t)
    }
  }

  const tasks = Array.from(map.values()).sort((a, b) => {
    const aDue = a.plannedDueDate ?? a.dueDate
    const bDue = b.plannedDueDate ?? b.dueDate
    if (!aDue) return 1
    if (!bDue) return -1
    return new Date(aDue).getTime() - new Date(bDue).getTime()
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
): Promise<Task[]> {
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

  const tasks = projectTasks
    .filter((t) => {
      if (t.isDeleted) return false
      if (t.status !== 'レビュー待ち') return false
      return isReviewerOfTask(t, userId, nameCandidates)
    })
    .sort((a, b) => {
      // 更新が新しい順（評価を急ぐものを上に）
      return (b.updatedAt || '').localeCompare(a.updatedAt || '')
    })

  return enrichPeopleNames(tasks)
}
