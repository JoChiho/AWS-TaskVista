import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors.js'
import * as repository from '../../src/projects/repository.js'
import * as service from '../../src/projects/service.js'
import { makeProject, OTHER_USER, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/repository.js', () => ({
  getProjectById: vi.fn(),
  listProjectsByCreator: vi.fn(),
  listProjectsByMember: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  softDeleteProject: vi.fn(),
}))

describe('projects/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('作成者とメンバーのプロジェクトを重複なく一覧取得する', async () => {
    const created = makeProject({ projectId: 'p1', createdAt: '2026-07-01T00:00:00.000Z' })
    const member = makeProject({
      projectId: 'p2',
      createdBy: OTHER_USER,
      memberIds: [OTHER_USER, USER_ID],
      createdAt: '2026-07-05T00:00:00.000Z',
    })
    vi.mocked(repository.listProjectsByCreator).mockResolvedValue([created])
    vi.mocked(repository.listProjectsByMember).mockResolvedValue([member, created])

    const result = await service.listProjects(USER_ID)
    expect(result).toHaveLength(2)
    expect(result[0].projectId).toBe('p2')
  })

  it('プロジェクトを正常に作成する', async () => {
    vi.mocked(repository.createProject).mockImplementation(async (p) => p)

    const result = await service.createProject(USER_ID, {
      name: '新規プロジェクト',
      description: '説明',
    })

    expect(result.name).toBe('新規プロジェクト')
    expect(result.createdBy).toBe(USER_ID)
    expect(result.memberIds).toContain(USER_ID)
  })

  it('名前が空の場合は ValidationError', async () => {
    await expect(service.createProject(USER_ID, { name: '' })).rejects.toThrow(ValidationError)
  })

  it('存在しないプロジェクトは NotFoundError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(null)
    await expect(service.getProject('missing', USER_ID)).rejects.toThrow(NotFoundError)
  })

  it('権限のないプロジェクトは ForbiddenError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(
      makeProject({ createdBy: OTHER_USER, memberIds: [OTHER_USER] }),
    )
    await expect(service.getProject('proj-001', USER_ID)).rejects.toThrow(ForbiddenError)
  })

  it('プロジェクトを更新する', async () => {
    const project = makeProject()
    const updated = { ...project, name: '更新後' }
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.updateProject).mockResolvedValue(updated)

    const result = await service.updateProject('proj-001', USER_ID, { name: '更新後' })
    expect(result.name).toBe('更新後')
  })

  it('更新項目が空の場合は ValidationError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(makeProject())
    await expect(service.updateProject('proj-001', USER_ID, {})).rejects.toThrow(ValidationError)
  })

  it('プロジェクトを論理削除する', async () => {
    const project = makeProject()
    const deleted = { ...project, isDeleted: true }
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.softDeleteProject).mockResolvedValue(deleted)

    const result = await service.deleteProject('proj-001', USER_ID)
    expect(result.isDeleted).toBe(true)
  })
})