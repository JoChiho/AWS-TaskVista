import { describe, expect, it } from 'vitest'
import {
  NEW_CHECK_ITEM_PLACEHOLDER,
  completeBlockMessage,
  incompleteRequiredDeliverables,
  newCheckItem,
  reviewSoftWarnMessage,
  wouldBecomeComplete,
} from './deliverable'

describe('utils/deliverable', () => {
  it('incompleteRequiredDeliverables: 無効時は空', () => {
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

  it('incompleteRequiredDeliverables: 必須未完了のみ', () => {
    const items = incompleteRequiredDeliverables({
      deliverableEnabled: true,
      deliverableChecklist: [
        {
          itemId: '1',
          title: '必須未',
          done: false,
          required: true,
          sortOrder: 0,
        },
        {
          itemId: '2',
          title: '任意未',
          done: false,
          required: false,
          sortOrder: 1,
        },
        {
          itemId: '3',
          title: '必須済',
          done: true,
          required: true,
          sortOrder: 2,
        },
      ],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('必須未')
  })

  it('completeBlockMessage / reviewSoftWarnMessage', () => {
    const task = {
      deliverableEnabled: true,
      deliverableChecklist: [
        {
          itemId: '1',
          title: 'X',
          done: false,
          required: true,
          sortOrder: 0,
        },
      ],
    }
    expect(completeBlockMessage(task)).toMatch(/未完了/)
    expect(reviewSoftWarnMessage(task)).toMatch(/続行/)
    expect(
      completeBlockMessage({
        deliverableEnabled: true,
        deliverableChecklist: [
          {
            itemId: '1',
            title: 'X',
            done: true,
            required: true,
            sortOrder: 0,
          },
        ],
      }),
    ).toBeNull()
  })

  it('wouldBecomeComplete', () => {
    expect(wouldBecomeComplete('完了', undefined, '進行中')).toBe(true)
    expect(wouldBecomeComplete(undefined, 100, '進行中')).toBe(true)
    expect(wouldBecomeComplete(undefined, 100, 'レビュー待ち')).toBe(false)
    expect(wouldBecomeComplete(undefined, 50, '進行中')).toBe(false)
  })

  it('newCheckItem は編集可能なプレースホルダ文言', () => {
    const item = newCheckItem()
    expect(item.title).toBe(NEW_CHECK_ITEM_PLACEHOLDER)
    expect(item.required).toBe(true)
    expect(item.done).toBe(false)
    expect(item.itemId).toBeTruthy()
  })
})
