import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as projectService from '../../src/projects/service.js'
import * as taskRepository from '../../src/tasks/repository.js'
import * as usersService from '../../src/users/service.js'
import * as service from '../../src/dashboard/service.js'
import { makeProject, makeTask, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/service.js', () => ({
  listProjects: vi.fn(),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  listTasksByProject: vi.fn(),
  listTasksByAssignee: vi.fn(),
}))

vi.mock('../../src/users/service.js', () => ({
  getDisplayName: vi.fn().mockResolvedValue(null),
  getDisplayNameMap: vi.fn().mockResolvedValue(new Map()),
}))

describe('dashboard/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usersService.getDisplayName).mockResolvedValue(null)
    vi.mocked(projectService.listProjects).mockResolvedValue([])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([])
  })

  it('プロジェクト横断のステータス統計を返す', async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({
        projectId: 'p1',
        name: 'P1',
        status: 'active',
        memberIds: [USER_ID, 'u2'],
        members: [
          { userId: USER_ID, email: 'a@example.com', displayName: 'A' },
          { userId: 'u2', email: 'b@example.com', displayName: 'B' },
        ],
        updatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({ status: '未着手', updatedAt: '2026-07-05T10:00:00.000Z' }),
      makeTask({
        taskId: 't2',
        status: '進行中',
        updatedAt: '2026-07-10T12:00:00.000Z',
      }),
      makeTask({ taskId: 't3', status: '完了', isDeleted: true }),
    ])

    const result = await service.getSummary(USER_ID)
    expect(result).toHaveLength(1)
    expect(result[0].totalTasks).toBe(2)
    expect(result[0].tasksByStatus['未着手']).toBe(1)
    expect(result[0].tasksByStatus['進行中']).toBe(1)
    expect(result[0].status).toBe('active')
    expect(result[0].memberCount).toBe(2)
    expect(result[0].lastUpdatedAt).toBe('2026-07-10T12:00:00.000Z')
  })

  it('WBS の親を重複計上せずリーフから進捗・工数・期間を集計する', async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({ projectId: 'p1', name: 'WBS Project' }),
    ])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({
        taskId: 'parent',
        projectId: 'p1',
        title: '設計',
        wbsCode: '1',
        status: '未着手',
      }),
      makeTask({
        taskId: 'leaf-1',
        projectId: 'p1',
        parentTaskId: 'parent',
        wbsCode: '1.1',
        status: '完了',
        completionPercent: 100,
        estimatedEffortDays: 2,
        actualEffortDays: 2,
        plannedStartDate: '2026-07-01',
        plannedDueDate: '2026-07-03',
      }),
      makeTask({
        taskId: 'leaf-2',
        projectId: 'p1',
        parentTaskId: 'parent',
        wbsCode: '1.2',
        status: '進行中',
        completionPercent: 50,
        estimatedEffortDays: 6,
        actualEffortDays: 3,
        plannedStartDate: '2026-07-04',
        plannedDueDate: '2026-07-12',
      }),
    ])

    const [summary] = await service.getSummary(USER_ID)

    expect(summary.totalNodeCount).toBe(3)
    expect(summary.totalTasks).toBe(2)
    expect(summary.leafTaskCount).toBe(2)
    expect(summary.summaryTaskCount).toBe(1)
    expect(summary.tasksByStatus['未着手']).toBe(0)
    expect(summary.tasksByStatus['完了']).toBe(1)
    expect(summary.tasksByStatus['進行中']).toBe(1)
    expect(summary.completionPercent).toBe(63)
    expect(summary.estimatedEffortDays).toBe(8)
    expect(summary.actualEffortDays).toBe(5)
    expect(summary.plannedStartDate).toBe('2026-07-01')
    expect(summary.plannedDueDate).toBe('2026-07-12')
  })

  it('未完了の担当タスクを締切日昇順で返す（assigneeId 一致）', async () => {
    // アクセス可能なプロジェクトが無いと担当タスクは返さない
    vi.mocked(projectService.listProjects).mockResolvedValue([makeProject()])
    vi.mocked(taskRepository.listTasksByAssignee).mockResolvedValue([
      makeTask({
        taskId: 't1',
        plannedDueDate: '2026-07-20',
        dueDate: '2026-07-20',
        status: '進行中',
        assigneeId: USER_ID,
      }),
      makeTask({
        taskId: 't2',
        plannedDueDate: '2026-07-10',
        dueDate: '2026-07-10',
        status: '未着手',
        assigneeId: USER_ID,
      }),
      makeTask({
        taskId: 't3',
        plannedDueDate: '2026-07-15',
        dueDate: '2026-07-15',
        status: '完了',
        assigneeId: USER_ID,
      }),
      makeTask({
        taskId: 't4',
        plannedDueDate: undefined,
        dueDate: undefined,
        status: '保留',
        assigneeId: USER_ID,
      }),
    ])

    const result = await service.getMyTasks(USER_ID)
    expect(result.map((t) => t.taskId)).toEqual(['t2', 't1', 't4'])
    expect(result.every((t) => t.status !== '完了')).toBe(true)
  })

  it('アクセスできないプロジェクトの担当タスクは返さない', async () => {
    // 自分が入れるプロジェクトは p1 のみ
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({ projectId: 'p1', name: '参加中' }),
    ])
    vi.mocked(taskRepository.listTasksByAssignee).mockResolvedValue([
      makeTask({
        taskId: 'keep',
        projectId: 'p1',
        status: '進行中',
        assigneeId: USER_ID,
        dueDate: '2026-07-10',
      }),
      makeTask({
        taskId: 'kicked',
        projectId: 'p-kicked',
        status: '未着手',
        assigneeId: USER_ID,
        dueDate: '2026-07-05',
      }),
    ])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([])

    const result = await service.getMyTasks(USER_ID)
    expect(result.map((t) => t.taskId)).toEqual(['keep'])
  })

  it('assigneeId が無く assigneeName のみの古いデータも表示名で拾う', async () => {
    vi.mocked(taskRepository.listTasksByAssignee).mockResolvedValue([])
    vi.mocked(usersService.getDisplayName).mockResolvedValue('徐')
    vi.mocked(projectService.listProjects).mockResolvedValue([makeProject()])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({
        taskId: 'old-1',
        assigneeId: undefined,
        assigneeName: '徐',
        status: '進行中',
        dueDate: '2026-08-01',
      }),
      makeTask({
        taskId: 'other',
        assigneeId: undefined,
        assigneeName: '別人',
        status: '未着手',
      }),
    ])

    const result = await service.getMyTasks(USER_ID, 'xuzhifu@findix.co.jp', '徐')
    expect(result.map((t) => t.taskId)).toEqual(['old-1'])
  })

  it('担当一覧は親を除外し、リーフへ WBS パスとプロジェクト名を付ける', async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({ projectId: 'p1', name: 'WBS Project' }),
    ])
    vi.mocked(taskRepository.listTasksByAssignee).mockResolvedValue([])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({
        taskId: 'parent',
        projectId: 'p1',
        title: '設計',
        wbsCode: '1',
        assigneeId: USER_ID,
      }),
      makeTask({
        taskId: 'leaf',
        projectId: 'p1',
        title: 'API 設計',
        parentTaskId: 'parent',
        wbsCode: '1.1',
        status: '進行中',
        assigneeId: USER_ID,
      }),
    ])

    const result = await service.getMyTasks(USER_ID)

    expect(result.map((task) => task.taskId)).toEqual(['leaf'])
    expect(result[0].projectName).toBe('WBS Project')
    expect(result[0].wbsPath).toEqual([
      { taskId: 'parent', wbsCode: '1', title: '設計' },
    ])
  })

  it('レビュー待ち一覧も親を除外してリーフだけを返す', async () => {
    vi.mocked(projectService.listProjects).mockResolvedValue([
      makeProject({ projectId: 'p1', name: 'WBS Project' }),
    ])
    vi.mocked(taskRepository.listTasksByProject).mockResolvedValue([
      makeTask({
        taskId: 'parent',
        projectId: 'p1',
        title: '設計',
        wbsCode: '1',
        status: 'レビュー待ち',
        reviewers: [{ userId: USER_ID, displayName: 'Reviewer' }],
      }),
      makeTask({
        taskId: 'leaf',
        projectId: 'p1',
        title: '成果物確認',
        parentTaskId: 'parent',
        wbsCode: '1.1',
        status: 'レビュー待ち',
        reviewers: [{ userId: USER_ID, displayName: 'Reviewer' }],
      }),
    ])

    const result = await service.getMyReviewTasks(USER_ID)

    expect(result.map((task) => task.taskId)).toEqual(['leaf'])
    expect(result[0].wbsPath[0]?.title).toBe('設計')
  })
})
