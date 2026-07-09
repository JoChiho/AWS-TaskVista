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
    vi.mocked(repository.updateTaskStatus).mockResolvedValue(updated)

    const result = await service.updateTaskStatus(TASK_ID, USER_ID, { status: '進行中' })
    expect(result.status).toBe('進行中')
  })

  it('権限のないプロジェクトのタスクは ForbiddenError', async () => {
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(
      makeProject({ createdBy: OTHER_USER, memberIds: [OTHER_USER] }),
    )
    await expect(service.listTasksByProject(PROJECT_ID, USER_ID)).rejects.toThrow(ForbiddenError)
  })

  it('存在しないタスクは NotFoundError', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(null)
    await expect(service.getTask('missing', USER_ID)).rejects.toThrow(NotFoundError)
  })
})