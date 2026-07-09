import * as projectService from '../projects/service.js'
import * as taskRepository from '../tasks/repository.js'
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

/** 自分が担当する未完了タスクを期日昇順で取得する */
export async function getMyTasks(userId: string): Promise<Task[]> {
  const tasks = await taskRepository.listTasksByAssignee(userId)

  return tasks
    .filter((t) => !t.isDeleted && t.status !== '完了')
    .sort((a, b) => {
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
}