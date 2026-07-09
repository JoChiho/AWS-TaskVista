import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as projectService from '../../src/projects/service.js'
import * as taskRepository from '../../src/tasks/repository.js'
import * as service from '../../src/dashboard/service.js'
import { makeProject, makeTask, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/service.js', () => ({
  listProjects: vi.fn(),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  listTasksByProject: vi.fn(),
  listTasksByAssignee: vi.fn(),
}))

describe('dashboard/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('プロジェクト横断のステータス統計を返す', async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({ projectId: 'p1', name: 'P1' }),
    ])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({ status: '未着手' }),
      makeTask({ taskId: 't2', status: '進行中' }),
      makeTask({ taskId: 't3', status: '完了', isDeleted: true }),
    ])

    const result = await service.getSummary(USER_ID)
    expect(result).toHaveLength(1)
    expect(result[0].totalTasks).toBe(2)
    expect(result[0].tasksByStatus['未着手']).toBe(1)
    expect(result[0].tasksByStatus['進行中']).toBe(1)
  })

  it('未完了の担当タスクを期日昇順で返す', async () => {
    vi.mocked(taskRepository.listTasksByAssignee).mockResolvedValue([
      makeTask({ taskId: 't1', dueDate: '2026-07-20', status: '進行中' }),
      makeTask({ taskId: 't2', dueDate: '2026-07-10', status: '未着手' }),
      makeTask({ taskId: 't3', dueDate: '2026-07-15', status: '完了' }),
      makeTask({ taskId: 't4', dueDate: undefined, status: '保留' }),
    ])

    const result = await service.getMyTasks(USER_ID)
    expect(result.map((t) => t.taskId)).toEqual(['t2', 't1', 't4'])
    expect(result.every((t) => t.status !== '完了')).toBe(true)
  })
})