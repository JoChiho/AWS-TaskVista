import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError, ValidationError } from '../../src/shared/errors.js'
import * as projectRepository from '../../src/projects/repository.js'
import * as repository from '../../src/attachments/repository.js'
import * as service from '../../src/attachments/service.js'
import { makeProject, makeTask, TASK_ID, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/repository.js', () => ({
  getProjectById: vi.fn(),
}))

vi.mock('../../src/attachments/repository.js', () => ({
  getTaskById: vi.fn(),
  createUploadUrl: vi.fn(),
  createDownloadUrl: vi.fn(),
  deleteS3Object: vi.fn(),
  updateTaskAttachments: vi.fn(),
}))

describe('attachments/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(projectRepository.getProjectById).mockResolvedValue(makeProject())
  })

  it('添付ファイル一覧を返す', async () => {
    const attachment = {
      attachmentId: 'att-1',
      filename: 'test.png',
      s3Key: 'tasks/task-001/att-1-test.png',
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: USER_ID,
      uploadedAt: '2026-07-07T10:00:00.000Z',
    }
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask({ attachments: [attachment] }))

    const result = await service.listAttachments(TASK_ID, USER_ID)
    expect(result).toHaveLength(1)
    expect(result[0].filename).toBe('test.png')
  })

  it('アップロード URL を発行する', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask())
    vi.mocked(repository.createUploadUrl).mockResolvedValue('https://s3.example.com/upload')
    vi.mocked(repository.updateTaskAttachments).mockResolvedValue(makeTask())

    const result = await service.getUploadUrl(TASK_ID, USER_ID, {
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    })

    expect(result.uploadUrl).toBe('https://s3.example.com/upload')
    expect(result.s3Key).toContain('tasks/task-001/')
    expect(repository.updateTaskAttachments).toHaveBeenCalled()
  })

  it('50MB 超のファイルは ValidationError', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask())
    await expect(
      service.getUploadUrl(TASK_ID, USER_ID, {
        filename: 'big.zip',
        contentType: 'application/zip',
        sizeBytes: 51 * 1024 * 1024,
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('ダウンロード URL を発行する', async () => {
    const attachment = {
      attachmentId: 'att-1',
      filename: 'test.png',
      s3Key: 'tasks/task-001/att-1-test.png',
      contentType: 'image/png',
      sizeBytes: 1024,
      uploadedBy: USER_ID,
      uploadedAt: '2026-07-07T10:00:00.000Z',
    }
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask({ attachments: [attachment] }))
    vi.mocked(repository.createDownloadUrl).mockResolvedValue('https://s3.example.com/download')

    const url = await service.getDownloadUrl(TASK_ID, 'att-1', USER_ID)
    expect(url).toBe('https://s3.example.com/download')
  })

  it('存在しない添付ファイルは NotFoundError', async () => {
    vi.mocked(repository.getTaskById).mockResolvedValue(makeTask({ attachments: [] }))
    await expect(service.getDownloadUrl(TASK_ID, 'missing', USER_ID)).rejects.toThrow(
      NotFoundError,
    )
  })
})