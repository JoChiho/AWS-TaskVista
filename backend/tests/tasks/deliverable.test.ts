import { describe, expect, it } from 'vitest'
import {
  blocksCompleteStatus,
  incompleteRequiredDeliverables,
  normalizeChecklist,
  softWarnReviewStatus,
} from '../../src/tasks/deliverable.js'

describe('tasks/deliverable', () => {
  it('deliverableEnabled が false / 未設定なら必須未完了は空', () => {
    expect(incompleteRequiredDeliverables({})).toEqual([])
    expect(
      incompleteRequiredDeliverables({
        deliverableEnabled: false,
        deliverableChecklist: [
          {
            itemId: '1',
            title: 'A',
            done: false,
            required: true,
            sortOrder: 0,
          },
        ],
      }),
    ).toEqual([])
  })

  it('必須かつ未完了のタイトルを返す', () => {
    const titles = incompleteRequiredDeliverables({
      deliverableEnabled: true,
      deliverableChecklist: [
        { itemId: '1', title: '必須A', done: false, required: true, sortOrder: 0 },
        { itemId: '2', title: '任意B', done: false, required: false, sortOrder: 1 },
        { itemId: '3', title: '必須C', done: true, required: true, sortOrder: 2 },
      ],
    })
    expect(titles).toEqual(['必須A'])
  })

  it('blocksCompleteStatus: 完了のみブロック', () => {
    const task = {
      deliverableEnabled: true,
      deliverableChecklist: [
        { itemId: '1', title: 'X', done: false, required: true, sortOrder: 0 },
      ],
    }
    expect(blocksCompleteStatus(task, '完了')).toMatch(/必須項目が未完了/)
    expect(blocksCompleteStatus(task, 'レビュー待ち')).toBeNull()
    expect(blocksCompleteStatus(task, '進行中')).toBeNull()
  })

  it('blocksCompleteStatus: 必須が揃えば null', () => {
    expect(
      blocksCompleteStatus(
        {
          deliverableEnabled: true,
          deliverableChecklist: [
            { itemId: '1', title: 'X', done: true, required: true, sortOrder: 0 },
          ],
        },
        '完了',
      ),
    ).toBeNull()
  })

  it('softWarnReviewStatus: レビュー待ちのみ警告', () => {
    const task = {
      deliverableEnabled: true,
      deliverableChecklist: [
        { itemId: '1', title: 'X', done: false, required: true, sortOrder: 0 },
      ],
    }
    expect(softWarnReviewStatus(task, 'レビュー待ち')).toMatch(/未完了/)
    expect(softWarnReviewStatus(task, '完了')).toBeNull()
    expect(softWarnReviewStatus({ deliverableEnabled: false }, 'レビュー待ち')).toBeNull()
  })

  it('normalizeChecklist は title / sortOrder / required を正規化する', () => {
    const out = normalizeChecklist([
      {
        itemId: 'a',
        title: '  項目  ',
        done: true,
        required: false,
      },
      {
        itemId: 'b',
        title: '',
        done: false,
        required: true,
        sortOrder: 5,
      },
    ])
    expect(out[0]).toMatchObject({
      itemId: 'a',
      title: '項目',
      done: true,
      required: false,
      sortOrder: 0,
    })
    expect(out[1]).toMatchObject({
      itemId: 'b',
      title: '（無題）',
      sortOrder: 5,
      required: true,
    })
  })
})
