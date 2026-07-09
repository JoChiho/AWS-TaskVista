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
    })
    expect(canAccessProject(project, USER_ID)).toBe(false)
  })

  it('削除済みプロジェクトにはアクセスできない', () => {
    const project = makeProject({ isDeleted: true })
    expect(canAccessProject(project, USER_ID)).toBe(false)
  })
})