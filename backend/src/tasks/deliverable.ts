/**
 * 成果物チェック（完了ハードゲート用）
 */
import type { DeliverableCheckItem, Task, TaskStatus } from '../shared/types.js'

/** 必須未完了のチェック項目タイトル一覧 */
export function incompleteRequiredDeliverables(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
): string[] {
  if (!task.deliverableEnabled) return []
  const items = task.deliverableChecklist ?? []
  return items
    .filter((i) => i.required && !i.done)
    .map((i) => i.title?.trim() || '（無題）')
}

/** 完了へ進めない（必須チェック未了） */
export function blocksCompleteStatus(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
  nextStatus: TaskStatus,
): string | null {
  if (nextStatus !== '完了') return null
  const incomplete = incompleteRequiredDeliverables(task)
  if (!incomplete.length) return null
  return `成果物チェックの必須項目が未完了です: ${incomplete.join('、')}`
}

/** レビュー待ち: ソフト警告用メッセージ（バックエンドはブロックしない） */
export function softWarnReviewStatus(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
  nextStatus: TaskStatus,
): string | null {
  if (nextStatus !== 'レビュー待ち') return null
  if (!task.deliverableEnabled) return null
  const incomplete = incompleteRequiredDeliverables(task)
  if (!incomplete.length) return null
  return `必須の成果物チェックが未完了です（${incomplete.length} 件）。レビュー提出前の確認をおすすめします。`
}

export function normalizeChecklist(
  items:
    | Array<{
        itemId: string
        title: string
        done: boolean
        required: boolean
        doneAt?: string
        doneBy?: string
        sortOrder?: number
      }>
    | undefined
    | null,
): DeliverableCheckItem[] {
  if (!items?.length) return []
  return items.map((item, index) => ({
    itemId: item.itemId,
    title: (item.title || '').trim() || '（無題）',
    done: Boolean(item.done),
    required: item.required !== false,
    doneAt: item.doneAt,
    doneBy: item.doneBy,
    sortOrder: item.sortOrder ?? index,
  }))
}
