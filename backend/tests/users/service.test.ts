import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/shared/errors.js'
import * as repository from '../../src/users/repository.js'
import * as service from '../../src/users/service.js'

vi.mock('../../src/users/repository.js', () => ({
  getProfile: vi.fn(),
  putProfile: vi.fn(),
  batchGetProfiles: vi.fn(),
}))

vi.mock('../../src/projects/repository.js', () => ({
  listProjectsByCreator: vi.fn().mockResolvedValue([]),
  listProjectsByMember: vi.fn().mockResolvedValue([]),
  listProjectsByMemberEmail: vi.fn().mockResolvedValue([]),
  updateProject: vi.fn(),
}))

vi.mock('../../src/tasks/repository.js', () => ({
  listTasksByAssignee: vi.fn().mockResolvedValue([]),
  updateTask: vi.fn(),
}))

const actor = {
  userId: 'user-001',
  email: 'user@example.com',
  name: 'テスト',
}

describe('users/service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('プロフィール未作成なら null', async () => {
    vi.mocked(repository.getProfile).mockResolvedValue(null)
    await expect(service.getMyProfile(actor)).resolves.toBeNull()
  })

  it('表示名をクラウドに保存する', async () => {
    vi.mocked(repository.getProfile).mockResolvedValue(null)
    vi.mocked(repository.putProfile).mockImplementation(async (p) => p)

    const result = await service.updateMyProfile(actor, { displayName: '徐 智甫' })
    expect(result.displayName).toBe('徐 智甫')
    expect(result.userId).toBe('user-001')
    expect(result.email).toBe('user@example.com')
    expect(repository.putProfile).toHaveBeenCalled()
  })

  it('空の表示名は ValidationError', async () => {
    await expect(service.updateMyProfile(actor, { displayName: '' })).rejects.toThrow(
      ValidationError,
    )
  })
})
