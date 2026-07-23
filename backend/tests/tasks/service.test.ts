import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors.js'
import * as commentRepository from '../../src/comments/repository.js'
import * as projectRepository from '../../src/projects/repository.js'
import * as repository from '../../src/tasks/repository.js'
import * as service from '../../src/tasks/service.js'
import { makeProject, makeTask, OTHER_USER, PROJECT_ID, TASK_ID, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/repository.js', () => ({
  getProjectById: vi.fn(),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  getTaskById: vi.fn(),
  listTasksByProject: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  softDeleteTask: vi.fn(),
}))

vi.mock('../../src/comments/repository.js', () => ({
  listCommentsByTask: vi.fn(),
}))

vi.mock('../../src/users/service.js', () => ({
  getDisplayNameMap: vi.fn().mockResolvedValue(new Map()),
  getDisplayName: vi.fn().mockResolvedValue(null),
}))

describe('tasks/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(makeProject())
  })

  it('プロジェクト内の未削除タスク一覧を返す', async () => {
    vi.mocked(repository.listTasksByProject).mockResolvedValue([
      makeTask(),
      makeTask({ taskId: 'task-002', isDeleted: true }),
    ])

    const result = await service.listTasksByProject(PROJECT_ID, USER_ID)
    expect(result).toHaveLength(1)
  })

  it('assigneeName がメールでもプロジェクト members の表示名に解決する', async () => {
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(
      makeProject({
        members: [
          {
            userId: OTHER_USER,
            email: 'h-sameshima@findix.co.jp',
            displayName: '鮫島',
          },
          {
            userId: USER_ID,
            email: 'user@example.com',
            displayName: 'テストユーザー',
          },
        ],
        memberIds: [USER_ID, OTHER_USER],
        memberEmails: ['user@example.com', 'h-sameshima@findix.co.jp'],
      }),
    )
    vi.mocked(repository.listTasksByProject).mockResolvedValue([
      makeTask({
        assigneeId: undefined,
        assigneeName: 'h-sameshima@findix.co.jp',
      }),
    ])

    const result = await service.listTasksByProject(PROJECT_ID, USER_ID)
    expect(result).toHaveLength(1)
    expect(result[0].assigneeName).toBe('鮫島')
    expect(result[0].assigneeId).toBe(OTHER_USER)
  })

  it('タスク詳細にコメント数を含める', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask())
    vi.mocked(commentRepository.listCommentsByTask).mockResolvedValue([
      { commentId: 'c1' } as never,
      { commentId: 'c2' } as never,
    ])

    const result = await service.getTask(TASK_ID, USER_ID)
    expect(result.commentCount).toBe(2)
  })

  it('タスクを作成する', async () => {
    vi.mocked(repository.createTask).mockImplementation(async (t) => t)

    const result = await service.createTask(PROJECT_ID, USER_ID, { title: '新規タスク' })
    expect(result.title).toBe('新規タスク')
    expect(result.status).toBe('未着手')
    expect(result.priority).toBe('medium')
  })

  it('予定開始日・予定工数・予定締切日・実績を作成時に保存する', async () => {
    vi.mocked(repository.createTask).mockImplementation(async (t) => t)

    const result = await service.createTask(PROJECT_ID, USER_ID, {
      title: 'スケジュール付き',
      plannedStartDate: '2026-08-01',
      plannedDueDate: '2026-08-10',
      actualStartDate: '2026-08-02',
      actualDueDate: '2026-08-11',
      estimatedEffortDays: 3.5,
      actualEffortDays: 4,
    })

    expect(result.plannedStartDate).toBe('2026-08-01')
    expect(result.plannedDueDate).toBe('2026-08-10')
    expect(result.actualStartDate).toBe('2026-08-02')
    expect(result.actualDueDate).toBe('2026-08-11')
    expect(result.estimatedEffortDays).toBe(3.5)
    expect(result.actualEffortDays).toBe(4)
    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        plannedStartDate: '2026-08-01',
        plannedDueDate: '2026-08-10',
        dueDate: '2026-08-10',
        actualStartDate: '2026-08-02',
        actualDueDate: '2026-08-11',
        estimatedEffortDays: 3.5,
        actualEffortDays: 4,
      }),
    )
  })

  it('予定開始日を更新・クリアできる', async () => {
    const task = makeTask({ plannedStartDate: undefined, plannedDueDate: '2026-07-15' })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => {
      const next = { ...task, ...updates }
      if (updates.plannedStartDate === null) delete next.plannedStartDate
      else if (updates.plannedStartDate !== undefined) {
        next.plannedStartDate = updates.plannedStartDate
      }
      return next
    })

    const saved = await service.updateTask(TASK_ID, USER_ID, {
      plannedStartDate: '2026-07-01',
    })
    expect(saved.plannedStartDate).toBe('2026-07-01')
    expect(repository.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ plannedStartDate: '2026-07-01' }),
    )

    const cleared = await service.updateTask(TASK_ID, USER_ID, { plannedStartDate: null })
    expect(repository.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ plannedStartDate: null }),
    )
    expect(cleared.plannedStartDate).toBeUndefined()
  })

  it('レビュー待ちで評価者を保存できる', async () => {
    const project = makeProject({
      memberIds: [USER_ID, OTHER_USER],
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'テストユーザー' },
        { userId: OTHER_USER, email: 'other@example.com', displayName: '評価者A' },
      ],
    })
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.createTask).mockImplementation(async (t) => t)

    const result = await service.createTask(PROJECT_ID, USER_ID, {
      title: 'レビュー依頼',
      status: 'レビュー待ち',
      reviewers: [{ userId: OTHER_USER, displayName: '評価者A' }],
    })

    expect(result.status).toBe('レビュー待ち')
    expect(result.reviewers).toHaveLength(1)
    expect(result.reviewers?.[0]?.userId).toBe(OTHER_USER)
    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewers: [expect.objectContaining({ userId: OTHER_USER })],
      }),
    )
  })

  it('評価者を空配列でクリアできる', async () => {
    const task = makeTask({
      status: 'レビュー待ち',
      reviewers: [{ userId: OTHER_USER, displayName: '評価者A' }],
    })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => ({
      ...task,
      ...updates,
      reviewers: updates.reviewers === null ? undefined : updates.reviewers,
    }))

    await service.updateTask(TASK_ID, USER_ID, { reviewers: [] })
    expect(repository.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ reviewers: null }),
    )
  })

  it('完了ステータスでも予定開始日を更新できる', async () => {
    const task = makeTask({
      status: '完了',
      completionPercent: 100,
      plannedDueDate: '2026-07-15',
    })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => ({
      ...task,
      ...updates,
      plannedStartDate:
        updates.plannedStartDate === null
          ? undefined
          : (updates.plannedStartDate ?? task.plannedStartDate),
    }))

    const result = await service.updateTask(TASK_ID, USER_ID, {
      plannedStartDate: '2026-07-10',
      estimatedEffortDays: 2,
      status: '完了',
    })
    expect(result.plannedStartDate).toBe('2026-07-10')
    expect(result.estimatedEffortDays).toBe(2)
    expect(result.status).toBe('完了')
  })

  it('タイトル未入力は ValidationError', async () => {
    await expect(service.createTask(PROJECT_ID, USER_ID, { title: '' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('無効なステータスは ValidationError', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask())
    await expect(
      service.updateTaskStatus(TASK_ID, USER_ID, { status: '無効' }),
    ).rejects.toThrow(ValidationError)
  })

  it('有効なステータス更新を行う', async () => {
    const task = makeTask()
    const updated = { ...task, status: '進行中' as const }
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockResolvedValue(updated)

    const result = await service.updateTaskStatus(TASK_ID, USER_ID, { status: '進行中' })
    expect(result.status).toBe('進行中')
    expect(repository.updateTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ status: '進行中' }),
    )
  })

  it('複数担当と完了度を保存できる', async () => {
    const project = makeProject({
      memberIds: [USER_ID, OTHER_USER],
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'テストユーザー' },
        { userId: OTHER_USER, email: 'other@example.com', displayName: 'メンバー' },
      ],
    })
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.createTask).mockImplementation(async (t) => t)

    const result = await service.createTask(PROJECT_ID, USER_ID, {
      title: '共同タスク',
      completionPercent: 40,
      assignees: [
        { userId: USER_ID, displayName: 'テストユーザー' },
        { userId: OTHER_USER, displayName: 'メンバー' },
      ],
    })

    expect(result.completionPercent).toBe(40)
    expect(result.status).toBe('進行中')
    expect(result.assignees).toHaveLength(2)
    expect(result.assigneeId).toBe(USER_ID)
    expect(result.assigneeName).toBe('テストユーザー')
  })

  it('完了度 0 / 100 は未着手 / 完了に連動する', async () => {
    const task = makeTask({ status: '進行中', completionPercent: 50 })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => ({
      ...task,
      ...updates,
    }))

    const toZero = await service.updateTask(TASK_ID, USER_ID, { completionPercent: 0 })
    expect(toZero.status).toBe('未着手')
    expect(toZero.completionPercent).toBe(0)

    const toFull = await service.updateTask(TASK_ID, USER_ID, { completionPercent: 100 })
    expect(toFull.status).toBe('完了')
    expect(toFull.completionPercent).toBe(100)
  })

  it('レビュー待ち・保留は完了度を変えてもステータスを維持する', async () => {
    const task = makeTask({ status: 'レビュー待ち', completionPercent: 30 })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => ({
      ...task,
      ...updates,
    }))

    const result = await service.updateTask(TASK_ID, USER_ID, { completionPercent: 100 })
    expect(result.status).toBe('レビュー待ち')
    expect(result.completionPercent).toBe(100)
  })

  it('任意完了度でレビュー待ちへ明示更新できる', async () => {
    const task = makeTask({ status: '進行中', completionPercent: 40 })
    vi.mocked(repository.getTaskById).mockResolvedValue(task)
    vi.mocked(repository.updateTask).mockImplementation(async (_id, updates) => ({
      ...task,
      ...updates,
    }))

    const result = await service.updateTask(TASK_ID, USER_ID, {
      status: 'レビュー待ち',
      completionPercent: 40,
    })
    expect(result.status).toBe('レビュー待ち')
    expect(result.completionPercent).toBe(40)
  })

  it('権限のないプロジェクトのタスクは ForbiddenError', async () => {
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(
      makeProject({
        createdBy: OTHER_USER,
        memberIds: [OTHER_USER],
        members: [{ userId: OTHER_USER, email: 'other@example.com', displayName: '他ユーザー' }],
        memberEmails: ['other@example.com'],
      }),
    )
    await expect(service.listTasksByProject(PROJECT_ID, USER_ID)).rejects.toThrow(ForbiddenError)
  })

  it('存在しないタスクは NotFoundError', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(null)
    await expect(service.getTask('missing', USER_ID)).rejects.toThrow(NotFoundError)
  })

  it('子がある親の進捗・予定工数更新は ValidationError', async () => {
    const parent = makeTask({ taskId: 'parent-1', title: '親' })
    const child = makeTask({
      taskId: 'child-1',
      parentTaskId: 'parent-1',
      title: '子',
      estimatedEffortDays: 2,
    })
    vi.mocked(repository.getTaskById).mockResolvedValue(parent)
    vi.mocked(repository.listTasksByProject).mockResolvedValue([parent, child])

    await expect(
      service.updateTask('parent-1', USER_ID, { completionPercent: 50 }),
    ).rejects.toThrow(ValidationError)

    await expect(
      service.updateTask('parent-1', USER_ID, { estimatedEffortDays: 5 }),
    ).rejects.toThrow(ValidationError)

    expect(repository.updateTask).not.toHaveBeenCalled()
  })

  it('WBS 深さ 4 になる親指定は ValidationError', async () => {
    const l1 = makeTask({ taskId: 'l1', title: 'L1', wbsCode: '1' })
    const l2 = makeTask({
      taskId: 'l2',
      parentTaskId: 'l1',
      title: 'L2',
      wbsCode: '1.1',
    })
    const l3 = makeTask({
      taskId: 'l3',
      parentTaskId: 'l2',
      title: 'L3',
      wbsCode: '1.1.1',
    })
    vi.mocked(repository.listTasksByProject).mockResolvedValue([l1, l2, l3])
    vi.mocked(repository.createTask).mockImplementation(async (t) => t)

    await expect(
      service.createTask(PROJECT_ID, USER_ID, {
        title: 'L4 は不可',
        parentTaskId: 'l3',
      }),
    ).rejects.toThrow(ValidationError)

    expect(repository.createTask).not.toHaveBeenCalled()
  })

  it('子がある親のかんばん status 更新は ValidationError', async () => {
    const parent = makeTask({ taskId: 'parent-1', title: '親', status: '進行中' })
    const child = makeTask({
      taskId: 'child-1',
      parentTaskId: 'parent-1',
      title: '子',
      status: '進行中',
    })
    vi.mocked(repository.getTaskById).mockResolvedValue(parent)
    vi.mocked(repository.listTasksByProject).mockResolvedValue([parent, child])

    await expect(
      service.updateTaskStatus('parent-1', USER_ID, { status: '完了' }),
    ).rejects.toThrow(ValidationError)

    expect(repository.updateTask).not.toHaveBeenCalled()
  })
})