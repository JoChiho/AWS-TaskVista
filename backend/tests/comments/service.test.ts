import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors.js'
import * as projectRepository from '../../src/projects/repository.js'
import * as taskRepository from '../../src/tasks/repository.js'
import * as repository from '../../src/comments/repository.js'
import * as service from '../../src/comments/service.js'
import { makeComment, makeProject, makeTask, OTHER_USER, TASK_ID, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/repository.js', () => ({
  getProjectById: vi.fn(),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  getTaskById: vi.fn(),
}))

vi.mock('../../src/comments/repository.js', () => ({
  listCommentsByTask: vi.fn(),
  createComment: vi.fn(),
  getCommentById: vi.fn(),
  deleteComment: vi.fn(),
}))

vi.mock('../../src/users/service.js', () => ({
  getDisplayNameMap: vi.fn().mockResolvedValue(new Map()),
  getDisplayName: vi.fn().mockResolvedValue(null),
}))

describe('comments/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(taskRepository.getTaskById).mockResolvedValue(makeTask())
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(makeProject())
  })

  it('コメント一覧を取得する', async () => {
    const comments = [makeComment()]
    vi.mocked(repository.listCommentsByTask).mockResolvedValue(comments)

    const result = await service.listComments(TASK_ID, USER_ID)
    expect(result).toEqual(comments)
  })

  it('コメントを作成する', async () => {
    vi.mocked(repository.createComment).mockImplementation(async (c) => c)

    const result = await service.createComment(TASK_ID, USER_ID, 'テストユーザー', {
      content: '新しいコメント',
    })
    expect(result.content).toBe('新しいコメント')
    expect(result.authorId).toBe(USER_ID)
  })

  it('空のコメントは ValidationError', async () => {
    await expect(
      service.createComment(TASK_ID, USER_ID, 'テストユーザー', { content: '' }),
    ).rejects.toThrow(ValidationError)
  })

  it('作成者のみコメントを削除できる', async () => {
    vi.mocked(repository.getCommentById).mockResolvedValue(makeComment({ authorId: USER_ID }))
    await service.deleteComment(TASK_ID, 'cmt-001', USER_ID)
    expect(repository.deleteComment).toHaveBeenCalledWith(TASK_ID, 'cmt-001')
  })

  it('他人のコメント削除は ForbiddenError', async () => {
    vi.mocked(repository.getCommentById).mockResolvedValue(
      makeComment({ authorId: OTHER_USER }),
    )
    await expect(service.deleteComment(TASK_ID, 'cmt-001', USER_ID)).rejects.toThrow(
      ForbiddenError,
    )
  })

  it('存在しないコメントは NotFoundError', async () => {
    vi.mocked(repository.getCommentById).mockResolvedValue(null)
    await expect(service.deleteComment(TASK_ID, 'missing', USER_ID)).rejects.toThrow(
      NotFoundError,
    )
  })
})