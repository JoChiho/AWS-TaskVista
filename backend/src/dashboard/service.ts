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

      return {
        projectId: project.projectId,
        name: project.name,
        totalTasks: tasks.length,
        tasksByStatus,
      }
    }),
  )

  return summaries
}

/**
 * 自分が担当する未完了タスクを期日昇順で取得する
 *
 * 判定ロジック:
 * 1. 主: assigneeId === ログインユーザーの Cognito sub（AssigneeIndex）
 * 2. 補: 古いデータで assigneeId が無く assigneeName のみの場合、
 *        クラウド表示名 / メールと一致すれば自分の担当とみなす
 */
export async function getMyTasks(
  userId: string,
  email?: string,
  name?: string,
): Promise<Task[]> {
  const byId = await taskRepository.listTasksByAssignee(userId)

  // 表示名（TaskVista-Users）とメールも照合用に取る
  const displayName = await usersService.getDisplayName(userId)
  const nameCandidates = new Set(
    [displayName, name, email?.split('@')[0]]
      .filter(Boolean)
      .map((s) => String(s).trim().toLowerCase()),
  )

  // アクセス可能なプロジェクト横断で、名前のみ一致する古いタスクも拾う
  const projects = await projectService.listProjects({
    userId,
    email,
    name: name || email || 'ユーザー',
  })

  const projectTasks = (
    await Promise.all(
      projects.map((p) => taskRepository.listTasksByProject(p.projectId)),
    )
  ).flat()

  const byName = projectTasks.filter((t) => {
    if (t.isDeleted || t.status === '完了') return false
    if (t.assigneeId === userId) return true
    if (!t.assigneeId && t.assigneeName) {
      return nameCandidates.has(t.assigneeName.trim().toLowerCase())
    }
    return false
  })

  const map = new Map<string, Task>()
  for (const t of [...byId, ...byName]) {
    if (!t.isDeleted && t.status !== '完了') {
      map.set(t.taskId, t)
    }
  }

  const tasks = Array.from(map.values()).sort((a, b) => {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  })

  // 担当者名をクラウド表示名で上書き（UI が一貫して最新名を出す）
  const ids = tasks.map((t) => t.assigneeId).filter(Boolean) as string[]
  if (ids.length === 0) return tasks
  const names = await usersService.getDisplayNameMap(ids)
  if (names.size === 0) return tasks
  return tasks.map((t) =>
    t.assigneeId && names.has(t.assigneeId)
      ? { ...t, assigneeName: names.get(t.assigneeId)! }
      : t,
  )
}
