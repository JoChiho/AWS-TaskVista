import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/task'
import { tasksFingerprint } from './tasks'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 't1',
    projectId: 'p1',
    title: 'A',
    status: '未着手',
    priority: 'medium',
    attachments: [],
    createdBy: 'u1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  }
}

describe('tasksFingerprint', () => {
  it('同一内容なら同じ fingerprint', () => {
    const a = [makeTask(), makeTask({ taskId: 't2', title: 'B' })]
    const b = [makeTask({ taskId: 't2', title: 'B' }), makeTask()]
    expect(tasksFingerprint(a)).toBe(tasksFingerprint(b))
  })

  it('updatedAt が変われば fingerprint が変わる', () => {
    const a = [makeTask()]
    const b = [makeTask({ updatedAt: '2026-07-02T00:00:00.000Z' })]
    expect(tasksFingerprint(a)).not.toBe(tasksFingerprint(b))
  })

  it('status が変われば fingerprint が変わる', () => {
    const a = [makeTask({ status: '未着手' })]
    const b = [makeTask({ status: '進行中' })]
    expect(tasksFingerprint(a)).not.toBe(tasksFingerprint(b))
  })
})
