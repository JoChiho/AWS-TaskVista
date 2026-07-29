import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/task'
import {
  WBS_MAX_DEPTH_INDEX,
  canAddChild,
  canIndent,
  canOutdent,
  childrenOf,
  depthOfTask,
  previousSibling,
  subtreeHeight,
} from './wbs'

function t(partial: Partial<Task> & { taskId: string }): Task {
  return {
    projectId: 'p1',
    title: partial.title ?? partial.taskId,
    status: '未着手',
    priority: 'medium',
    attachments: [],
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    ...partial,
  }
}

describe('utils/wbs structure helpers', () => {
  const tree: Task[] = [
    t({ taskId: 'r1', title: 'R1', wbsCode: '1', sortOrder: 0 }),
    t({ taskId: 'r2', title: 'R2', wbsCode: '2', sortOrder: 1 }),
    t({
      taskId: 'c1',
      title: 'C1',
      parentTaskId: 'r1',
      wbsCode: '1.1',
      sortOrder: 0,
    }),
    t({
      taskId: 'c2',
      title: 'C2',
      parentTaskId: 'r1',
      wbsCode: '1.2',
      sortOrder: 1,
    }),
    t({
      taskId: 'g1',
      title: 'G1',
      parentTaskId: 'c1',
      wbsCode: '1.1.1',
      sortOrder: 0,
    }),
  ]

  it('childrenOf sortOrder は wbsCode より sortOrder 優先', () => {
    const rootsWbs = childrenOf(tree, null, 'asc', 'wbs')
    expect(rootsWbs.map((x) => x.taskId)).toEqual(['r1', 'r2'])

    // sortOrder を入れ替えても wbs 順は 1,2
    const flipped = tree.map((x) =>
      x.taskId === 'r1'
        ? { ...x, sortOrder: 5 }
        : x.taskId === 'r2'
          ? { ...x, sortOrder: 0 }
          : x,
    )
    const bySort = childrenOf(flipped, null, 'asc', 'sortOrder')
    expect(bySort.map((x) => x.taskId)).toEqual(['r2', 'r1'])

    const byWbs = childrenOf(flipped, null, 'asc', 'wbs')
    expect(byWbs.map((x) => x.taskId)).toEqual(['r1', 'r2'])
  })

  it('depthOfTask / canAddChild / canOutdent', () => {
    const r1 = tree.find((x) => x.taskId === 'r1')!
    const c1 = tree.find((x) => x.taskId === 'c1')!
    const g1 = tree.find((x) => x.taskId === 'g1')!
    expect(depthOfTask(r1, tree)).toBe(0)
    expect(depthOfTask(c1, tree)).toBe(1)
    expect(depthOfTask(g1, tree)).toBe(2)
    expect(canAddChild(r1, tree)).toBe(true)
    expect(canAddChild(c1, tree)).toBe(true)
    expect(canAddChild(g1, tree)).toBe(false)
    expect(canOutdent(r1)).toBe(false)
    expect(canOutdent(c1)).toBe(true)
  })

  it('subtreeHeight', () => {
    const r1 = tree.find((x) => x.taskId === 'r1')!
    const g1 = tree.find((x) => x.taskId === 'g1')!
    expect(subtreeHeight(g1, tree)).toBe(1)
    // r1 -> c1 -> g1 と r1 -> c2
    expect(subtreeHeight(r1, tree)).toBe(3)
  })

  it('previousSibling / canIndent', () => {
    const c1 = tree.find((x) => x.taskId === 'c1')!
    const c2 = tree.find((x) => x.taskId === 'c2')!
    expect(previousSibling(c1, tree)).toBeNull()
    expect(previousSibling(c2, tree)?.taskId).toBe('c1')
    // c2 を c1 の子へ: c1 depth1 → c2 becomes depth2, leaf OK
    expect(canIndent(c2, tree)).toBe(true)
    // g1 は第3層・直前兄弟なし
    const g1 = tree.find((x) => x.taskId === 'g1')!
    expect(canIndent(g1, tree)).toBe(false)
  })

  it('子持ちを第3層相当へ字下げすると canIndent false', () => {
    // r2 の下に c1(子持ち) を字下げしたい状況ではなく、
    // c2 を leaf のまま indent は OK。c1 を indent する直前兄弟が無い。
    // r2 を r1 の子へ: r2 は leaf → depth1 OK
    const r2 = tree.find((x) => x.taskId === 'r2')!
    // r2 の直前兄弟は r1。indent → r1 の子 depth1、r2 leaf height1 → max 1 OK
    expect(canIndent(r2, tree)).toBe(true)

    // 人工: L2 に子持ちノードを置き indent しようとする
    // prev = c2 (depth1), task = 子持ち (sort after c2)
    const heavy = t({
      taskId: 'heavy',
      parentTaskId: 'r1',
      sortOrder: 2,
      wbsCode: '1.3',
    })
    const heavyChild = t({
      taskId: 'hc',
      parentTaskId: 'heavy',
      sortOrder: 0,
      wbsCode: '1.3.1',
    })
    const all = [...tree, heavy, heavyChild]
    // heavy の直前は c2。indent under c2 → depth 2 + height 2 - 1 = 3 > 2
    expect(subtreeHeight(heavy, all)).toBe(2)
    expect(canIndent(heavy, all)).toBe(false)
  })

  it('WBS_MAX_DEPTH_INDEX is 2 (L1..L3)', () => {
    expect(WBS_MAX_DEPTH_INDEX).toBe(2)
  })
})
