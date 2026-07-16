import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/shared/errors.js'
import * as cognito from '../../src/shared/cognito.js'
import * as repository from '../../src/projects/repository.js'
import * as service from '../../src/projects/service.js'
import { makeProject, OTHER_USER, USER_ID } from '../helpers/fixtures.js'

vi.mock('../../src/projects/repository.js', () => ({
  getProjectById: vi.fn(),
  listProjectsByCreator: vi.fn(),
  listProjectsByMember: vi.fn(),
  listProjectsByMemberEmail: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  softDeleteProject: vi.fn(),
}))

vi.mock('../../src/shared/cognito.js', () => ({
  findCognitoUserByEmail: vi.fn(),
}))

vi.mock('../../src/users/service.js', () => ({
  getDisplayNameMap: vi.fn().mockResolvedValue(new Map()),
  getDisplayName: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  listTasksByProject: vi.fn().mockResolvedValue([]),
  clearAssignee: vi.fn().mockResolvedValue({}),
}))

const actor = {
  userId: USER_ID,
  email: 'user@example.com',
  name: 'テストユーザー',
}

const memberActor = {
  userId: OTHER_USER,
  email: 'other@example.com',
  name: '他ユーザー',
}

describe('projects/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repository.listProjectsByMemberEmail).mockResolvedValue([])
    vi.mocked(repository.updateProject).mockImplementation(async (_id, updates) =>
      makeProject(updates as never),
    )
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

    const result = await service.listProjects(actor)
    expect(result).toHaveLength(2)
    expect(result[0].projectId).toBe('p2')
  })

  it('プロジェクトを正常に作成する', async () => {
    vi.mocked(repository.createProject).mockImplementation(async (p) => p)

    const result = await service.createProject(actor, {
      name: '新規プロジェクト',
      description: '説明',
      creatorDisplayName: '徐',
    })

    expect(result.name).toBe('新規プロジェクト')
    expect(result.createdBy).toBe(USER_ID)
    expect(result.memberIds).toContain(USER_ID)
    expect(result.members?.[0].displayName).toBe('徐')
    expect(result.memberEmails).toContain('user@example.com')
  })

  it('名前が空の場合は ValidationError', async () => {
    await expect(service.createProject(actor, { name: '' })).rejects.toThrow(ValidationError)
  })

  it('存在しないプロジェクトは NotFoundError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(null)
    await expect(service.getProject('missing', actor)).rejects.toThrow(NotFoundError)
  })

  it('権限のないプロジェクトは ForbiddenError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(
      makeProject({ createdBy: OTHER_USER, memberIds: [OTHER_USER], members: [], memberEmails: [] }),
    )
    await expect(service.getProject('proj-001', actor)).rejects.toThrow(ForbiddenError)
  })

  it('Cognito 上のユーザーを即時メンバーに追加する', async () => {
    const project = makeProject({
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'テスト' },
      ],
      memberEmails: ['user@example.com'],
    })
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.updateProject).mockImplementation(async (_id, updates) => ({
      ...project,
      ...updates,
    }))
    vi.mocked(cognito.findCognitoUserByEmail).mockResolvedValue({
      userId: OTHER_USER,
      email: 'h-sameshima@findix.co.jp',
      displayName: '鮫島',
    })

    const result = await service.addProjectMember(project.projectId, actor, {
      email: 'h-sameshima@findix.co.jp',
      displayName: '鮫島',
    })

    expect(result.members?.some((m) => m.email === 'h-sameshima@findix.co.jp')).toBe(true)
    expect(result.memberEmails).toContain('h-sameshima@findix.co.jp')
    expect(result.memberIds).toContain(OTHER_USER)
    expect(cognito.findCognitoUserByEmail).toHaveBeenCalledWith('h-sameshima@findix.co.jp')
  })

  it('Cognito にいないメールは ValidationError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(makeProject())
    vi.mocked(cognito.findCognitoUserByEmail).mockResolvedValue(null)

    await expect(
      service.addProjectMember('proj-001', actor, { email: 'nobody@example.com' }),
    ).rejects.toThrow(ValidationError)
  })

  it('オーナー以外がメンバーを追加すると ForbiddenError', async () => {
    const project = makeProject({
      createdBy: USER_ID,
      memberIds: [USER_ID, OTHER_USER],
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'オーナー' },
        { userId: OTHER_USER, email: 'other@example.com', displayName: 'メンバー' },
      ],
      memberEmails: ['user@example.com', 'other@example.com'],
    })
    vi.mocked(repository.getProjectById).mockResolvedValue(project)

    await expect(
      service.addProjectMember(project.projectId, memberActor, {
        email: 'someone@example.com',
      }),
    ).rejects.toThrow(ForbiddenError)
  })

  it('一般メンバーは他メンバーを削除できない', async () => {
    const third = 'user-003'
    const project = makeProject({
      createdBy: USER_ID,
      memberIds: [USER_ID, OTHER_USER, third],
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'オーナー' },
        { userId: OTHER_USER, email: 'other@example.com', displayName: 'メンバーA' },
        { userId: third, email: 'third@example.com', displayName: 'メンバーB' },
      ],
      memberEmails: ['user@example.com', 'other@example.com', 'third@example.com'],
    })
    vi.mocked(repository.getProjectById).mockResolvedValue(project)

    await expect(
      service.removeProjectMember(project.projectId, memberActor, third),
    ).rejects.toThrow(ForbiddenError)
  })

  it('一般メンバーは自分自身を退出できる', async () => {
    const project = makeProject({
      createdBy: USER_ID,
      memberIds: [USER_ID, OTHER_USER],
      members: [
        { userId: USER_ID, email: 'user@example.com', displayName: 'オーナー' },
        { userId: OTHER_USER, email: 'other@example.com', displayName: 'メンバー' },
      ],
      memberEmails: ['user@example.com', 'other@example.com'],
    })
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.updateProject).mockImplementation(async (_id, updates) => ({
      ...project,
      ...updates,
    }))

    const result = await service.removeProjectMember(
      project.projectId,
      memberActor,
      'other@example.com',
    )
    expect(result.memberIds).not.toContain(OTHER_USER)
    expect(result.memberEmails).not.toContain('other@example.com')
  })

  it('プロジェクトを更新する', async () => {
    const project = makeProject()
    const updated = { ...project, name: '更新後' }
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.updateProject).mockResolvedValue(updated)

    const result = await service.updateProject('proj-001', actor, { name: '更新後' })
    expect(result.name).toBe('更新後')
  })

  it.each(['planning', 'active', 'on_hold', 'completed', 'archived'] as const)(
    'ステータス %s で更新できる（フロントの PROJECT_STATUS と一致）',
    async (status) => {
      const project = makeProject()
      vi.mocked(repository.getProjectById).mockResolvedValue(project)
      vi.mocked(repository.updateProject).mockImplementation(async (_id, updates) => ({
        ...project,
        ...updates,
        status: updates.status ?? project.status,
      }))

      const result = await service.updateProject('proj-001', actor, { status })
      expect(result.status).toBe(status)
      expect(repository.updateProject).toHaveBeenCalledWith(
        'proj-001',
        expect.objectContaining({ status }),
      )
    },
  )

  it('未対応のステータスは ValidationError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(makeProject())
    await expect(
      service.updateProject('proj-001', actor, { status: '進行中' as 'active' }),
    ).rejects.toThrow(ValidationError)
  })

  it('更新項目が空の場合は ValidationError', async () => {
    vi.mocked(repository.getProjectById).mockResolvedValue(makeProject())
    await expect(service.updateProject('proj-001', actor, {})).rejects.toThrow(ValidationError)
  })

  it('プロジェクトを論理削除する', async () => {
    const project = makeProject()
    const deleted = { ...project, isDeleted: true }
    vi.mocked(repository.getProjectById).mockResolvedValue(project)
    vi.mocked(repository.softDeleteProject).mockResolvedValue(deleted)

    const result = await service.deleteProject('proj-001', actor)
    expect(result.isDeleted).toBe(true)
  })
})
