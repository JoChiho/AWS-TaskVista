import { describe, expect, it } from 'vitest'
import { makeTask } from '../helpers/fixtures.js'
import {
  collectDescendantIds,
  computeRollupFromChildren,
  depthOf,
  enrichWithWbs,
  planFullWbsRenumber,
  exceedsMaxDepth,
  buildById,
  nextWbsCode,
  planMissingWbsCodes,
  renumberSubtreeCodes,
  wouldCreateCycle,
  WBS_MAX_DEPTH,
} from '../../src/tasks/wbs.js'

describe('wbs helpers', () => {
  it('depthOf / exceedsMaxDepth', () => {
    const root = makeTask({ taskId: 'r', parentTaskId: undefined })
    const c1 = makeTask({ taskId: 'c1', parentTaskId: 'r' })
    const c2 = makeTask({ taskId: 'c2', parentTaskId: 'c1' })
    const byId = buildById([root, c1, c2])
    expect(depthOf('r', byId)).toBe(1)
    expect(depthOf('c1', byId)).toBe(2)
    expect(depthOf('c2', byId)).toBe(3)
    expect(exceedsMaxDepth('c2', byId, WBS_MAX_DEPTH)).toBe(true)
    expect(exceedsMaxDepth('c1', byId, WBS_MAX_DEPTH)).toBe(false)
  })

  it('wouldCreateCycle', () => {
    const root = makeTask({ taskId: 'r' })
    const c1 = makeTask({ taskId: 'c1', parentTaskId: 'r' })
    const byId = buildById([root, c1])
    expect(wouldCreateCycle('r', 'c1', byId)).toBe(true)
    expect(wouldCreateCycle('c1', 'r', byId)).toBe(false)
  })

  it('collectDescendantIds', () => {
    const tasks = [
      makeTask({ taskId: 'r' }),
      makeTask({ taskId: 'a', parentTaskId: 'r' }),
      makeTask({ taskId: 'b', parentTaskId: 'a' }),
      makeTask({ taskId: 'x' }),
    ]
    expect(collectDescendantIds('r', tasks).sort()).toEqual(['a', 'b'])
  })

  it('computeRollupFromChildren weighted completion & status policy', () => {
    const kids = [
      makeTask({
        taskId: 'a',
        estimatedEffortDays: 2,
        completionPercent: 100,
        status: '完了',
        plannedStartDate: '2026-08-01',
        plannedDueDate: '2026-08-05',
        assignees: [{ userId: 'u1', displayName: 'A' }],
      }),
      makeTask({
        taskId: 'b',
        estimatedEffortDays: 2,
        completionPercent: 0,
        status: '未着手',
        plannedStartDate: '2026-08-03',
        plannedDueDate: '2026-08-10',
        assignees: [{ userId: 'u2', displayName: 'B' }],
      }),
    ]
    // 完了 + 未着手の混在 → 途中なので親は進行中（進捗 50% と整合）
    const rMixed = computeRollupFromChildren(kids, '保留')
    expect(rMixed.estimatedEffortDaysSum).toBe(4)
    expect(rMixed.completionPercent).toBe(50)
    expect(rMixed.plannedStartDate).toBe('2026-08-01')
    expect(rMixed.plannedDueDate).toBe('2026-08-10')
    expect(rMixed.statusMode).toBe('forced_progress')
    expect(rMixed.status).toBe('進行中')
    expect(rMixed.assignees).toHaveLength(2)

    // 全未着手のみ → idle
    const allIdle = [
      makeTask({ taskId: 'i1', status: '未着手', estimatedEffortDays: 1 }),
      makeTask({ taskId: 'i2', status: '未着手', estimatedEffortDays: 1 }),
    ]
    const rAllIdle = computeRollupFromChildren(allIdle, '進行中')
    expect(rAllIdle.statusMode).toBe('idle_choice')
    expect(rAllIdle.status).toBe('未着手')
    expect(rAllIdle.completionPercent).toBe(0)

    const withProgress = [
      kids[0]!,
      makeTask({ taskId: 'c', status: '進行中', estimatedEffortDays: 1 }),
    ]
    const rProg = computeRollupFromChildren(withProgress, '未着手')
    expect(rProg.statusMode).toBe('forced_progress')
    expect(rProg.status).toBe('進行中')

    const allDone = [
      makeTask({
        taskId: 'd',
        status: '完了',
        estimatedEffortDays: 1,
        actualDueDate: '2026-08-05',
      }),
      makeTask({
        taskId: 'e',
        status: '完了',
        estimatedEffortDays: 1,
        actualDueDate: '2026-08-12',
      }),
    ]
    const rDone = computeRollupFromChildren(allDone, 'レビュー待ち')
    expect(rDone.statusMode).toBe('all_done_choice')
    expect(rDone.status).toBe('レビュー待ち')
    expect(rDone.allowedStatuses).toEqual(['完了', 'レビュー待ち'])
    expect(rDone.actualDueDate).toBe('2026-08-12')

    // 一部のみ完了: 実績終了は親に載せない
    const partial = [
      makeTask({
        taskId: 'f',
        status: '完了',
        estimatedEffortDays: 1,
        actualDueDate: '2026-08-05',
      }),
      makeTask({ taskId: 'g', status: '未着手', estimatedEffortDays: 1 }),
    ]
    const rPartial = computeRollupFromChildren(partial, '未着手')
    expect(rPartial.actualDueDate).toBeUndefined()
  })

  it('nextWbsCode', () => {
    const tasks = [
      makeTask({ taskId: 'r', wbsCode: '1' }),
      makeTask({ taskId: 'r2', wbsCode: '2' }),
      makeTask({ taskId: 'c', parentTaskId: 'r', wbsCode: '1.1' }),
    ]
    expect(nextWbsCode(tasks, null)).toBe('3')
    expect(nextWbsCode(tasks, tasks[0])).toBe('1.2')
    // 移動中の自分は兄弟から除外
    expect(nextWbsCode(tasks, tasks[0], 'c')).toBe('1.1')
  })

  it('planMissingWbsCodes fills child under parent', () => {
    const tasks = [
      makeTask({ taskId: 'r', wbsCode: '1' }),
      makeTask({ taskId: 'orphan-child', parentTaskId: 'r' }), // 後から親付け・番号なし
    ]
    const patches = planMissingWbsCodes(tasks)
    expect(patches).toEqual([{ taskId: 'orphan-child', wbsCode: '1.1' }])
  })

  it('renumberSubtreeCodes renames descendants', () => {
    const tasks = [
      makeTask({ taskId: 'r', wbsCode: '2' }),
      makeTask({ taskId: 'c', parentTaskId: 'r', wbsCode: '2.1' }),
      makeTask({ taskId: 'g', parentTaskId: 'c', wbsCode: '2.1.1' }),
    ]
    const codes = renumberSubtreeCodes('r', '1.2', tasks)
    expect(codes.find((c) => c.taskId === 'r')?.wbsCode).toBe('1.2')
    expect(codes.find((c) => c.taskId === 'c')?.wbsCode).toBe('1.2.1')
    expect(codes.find((c) => c.taskId === 'g')?.wbsCode).toBe('1.2.1.1')
  })

  it('enrichWithWbs attaches rollup on parent', () => {
    const tasks = [
      makeTask({ taskId: 'r', title: '親' }),
      makeTask({
        taskId: 'c',
        parentTaskId: 'r',
        estimatedEffortDays: 3,
        completionPercent: 100,
        status: '完了',
      }),
    ]
    const out = enrichWithWbs(tasks)
    const parent = out.find((t) => t.taskId === 'r')!
    expect(parent.childCount).toBe(1)
    expect(parent.rollup?.estimatedEffortDaysSum).toBe(3)
    expect(parent.rollup?.completionPercent).toBe(100)
  })

  it('planFullWbsRenumber assigns sequential codes by sortOrder', () => {
    const tasks = [
      makeTask({ taskId: 'b', sortOrder: 1, wbsCode: 'x' }),
      makeTask({ taskId: 'a', sortOrder: 0, wbsCode: 'y' }),
      makeTask({ taskId: 'a1', parentTaskId: 'a', sortOrder: 0, wbsCode: 'z' }),
    ]
    const patches = planFullWbsRenumber(tasks)
    expect(patches.find((p) => p.taskId === 'a')).toEqual({
      taskId: 'a',
      wbsCode: '1',
      sortOrder: 0,
    })
    expect(patches.find((p) => p.taskId === 'a1')).toEqual({
      taskId: 'a1',
      wbsCode: '1.1',
      sortOrder: 0,
    })
    expect(patches.find((p) => p.taskId === 'b')).toEqual({
      taskId: 'b',
      wbsCode: '2',
      sortOrder: 1,
    })
  })
})
