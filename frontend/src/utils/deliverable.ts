/**
 * 成果物チェック（完了ハードゲート / レビューソフト警告）
 */
import type { DeliverableCheckItem, Task, TaskStatus } from '@/types/task'

export function incompleteRequiredDeliverables(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
): DeliverableCheckItem[] {
  if (!task.deliverableEnabled) return []
  return (task.deliverableChecklist ?? []).filter((i) => i.required && !i.done)
}

/** 完了に進めない場合のメッセージ */
export function completeBlockMessage(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
): string | null {
  const items = incompleteRequiredDeliverables(task)
  if (!items.length) return null
  const titles = items.map((i) => i.title?.trim() || '（無題）')
  return `成果物チェックの必須項目が未完了です: ${titles.join('、')}`
}

/** レビュー待ちへのソフト警告 */
export function reviewSoftWarnMessage(
  task: Pick<Task, 'deliverableEnabled' | 'deliverableChecklist'>,
): string | null {
  if (!task.deliverableEnabled) return null
  const items = incompleteRequiredDeliverables(task)
  if (!items.length) return null
  return `必須の成果物チェックが未完了です（${items.length} 件）。レビュー提出前に確認することをおすすめします。続行しますか？`
}

export function wouldBecomeComplete(
  nextStatus: TaskStatus | undefined,
  nextCompletion: number | undefined,
  currentStatus: TaskStatus,
): boolean {
  if (nextStatus === '完了') return true
  if (
    nextCompletion !== undefined &&
    nextStatus === undefined &&
    nextCompletion >= 100 &&
    currentStatus !== 'レビュー待ち' &&
    currentStatus !== '保留'
  ) {
    return true
  }
  if (nextCompletion !== undefined && nextCompletion >= 100 && nextStatus === '進行中') {
    return true
  }
  return false
}

/** 新規チェック項目のプレースホルダ文言（クリックで編集できることを示す） */
export const NEW_CHECK_ITEM_PLACEHOLDER =
  '新しいチェック項目（クリックして編集）'

export function newCheckItem(title = ''): DeliverableCheckItem {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ci-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  return {
    itemId: id,
    title: title || NEW_CHECK_ITEM_PLACEHOLDER,
    done: false,
    required: true,
    sortOrder: 0,
  }
}
