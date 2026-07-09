import { describe, expect, it } from 'vitest'
import { canAccessProject } from '../../src/shared/types.js'
import { makeProject, OTHER_USER, USER_ID } from '../helpers/fixtures.js'

describe('shared/types', () => {
  it('作成者はプロジェクトにアクセスできる', () => {
    const project = makeProject({ createdBy: USER_ID })
    expect(canAccessProject(project, USER_ID)).toBe(true)
  })

  it('メンバーはプロジェクトにアクセスできる', () => {
    const project = makeProject({
      createdBy: OTHER_USER,
      memberIds: [OTHER_USER, USER_ID],
    })
    expect(canAccessProject(project, USER_ID)).toBe(true)
  })

  it('権限のないユーザーはアクセスできない', () => {
    const project = makeProject({
      createdBy: OTHER_USER,
      memberIds: [OTHER_USER],
      members: [{ userId: OTHER_USER, email: 'other@example.com', displayName: '他' }],
      memberEmails: ['other@example.com'],
    })
    expect(canAccessProject(project, USER_ID)).toBe(false)
  })

  it('招待メールのユーザーはアクセスできる', () => {
    const project = makeProject({
      createdBy: OTHER_USER,
      memberIds: [OTHER_USER],
      members: [
        { userId: OTHER_USER, email: 'other@example.com', displayName: '他' },
        { email: 'user@example.com', displayName: '招待中' },
      ],
      memberEmails: ['other@example.com', 'user@example.com'],
    })
    expect(canAccessProject(project, USER_ID, 'user@example.com')).toBe(true)
  })

  it('削除済みプロジェクトにはアクセスできない', () => {
    const project = makeProject({ isDeleted: true })
    expect(canAccessProject(project, USER_ID)).toBe(false)
  })
})