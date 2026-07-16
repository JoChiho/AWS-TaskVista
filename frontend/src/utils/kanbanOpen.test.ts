import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/task'
import { prepareTaskForDetail, shouldOpenDetailOnPointerUp } from './kanbanOpen'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    projectId: 'proj-1',
    title: 'テスト',
    status: '未着手',
    priority: 'medium',
    attachments: [],
    createdBy: 'user-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  }
}

describe('prepareTaskForDetail', () => {
  it('taskId が無いと null', () => {
    expect(
      prepareTaskForDetail(makeTask({ taskId: '' }), () => '名'),
    ).toBeNull()
    expect(prepareTaskForDetail(null, () => '名')).toBeNull()
  })

  it('表示名解決結果を assigneeName に入れる', () => {
    const result = prepareTaskForDetail(
      makeTask({ assigneeId: 'u1', assigneeName: 'mail@x.com' }),
      () => '鮫島',
    )
    expect(result).not.toBeNull()
    expect(result!.assigneeName).toBe('鮫島')
    expect(result!.taskId).toBe('task-1')
  })

  it('解決名が空なら元の assigneeName を残す', () => {
    const result = prepareTaskForDetail(
      makeTask({ assigneeName: '既存名' }),
      () => '',
    )
    expect(result!.assigneeName).toBe('既存名')
  })
})

describe('shouldOpenDetailOnPointerUp', () => {
  it('通常クリックは開く', () => {
    expect(
      shouldOpenDetailOnPointerUp({
        dragMoved: false,
        pointerDownTargetIsHandle: false,
      }),
    ).toBe(true)
  })

  it('ハンドル上やドラッグ後は開かない', () => {
    expect(
      shouldOpenDetailOnPointerUp({
        dragMoved: true,
        pointerDownTargetIsHandle: false,
      }),
    ).toBe(false)
    expect(
      shouldOpenDetailOnPointerUp({
        dragMoved: false,
        pointerDownTargetIsHandle: true,
      }),
    ).toBe(false)
  })
})

describe('open detail state machine', () => {
  it('prepare 成功後は showDetail を true にできる（呼び出し側の契約）', () => {
    // Board の openTaskDetail と同じ順序をシミュレート
    let currentTask: Task | null = null
    let showDetail = false

    const task = makeTask({
      taskId: 't-open',
      assigneeName: 'h-sameshima@findix.co.jp',
    })
    const prepared = prepareTaskForDetail(task, () => '鮫島')
    expect(prepared).not.toBeNull()

    currentTask = prepared
    showDetail = true

    expect(showDetail).toBe(true)
    expect(currentTask?.taskId).toBe('t-open')
    expect(currentTask?.assigneeName).toBe('鮫島')
  })
})
