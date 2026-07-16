// かんばん詳細オープンの純粋ロジック（UI から切り離してテスト可能にする）
import type { Task } from '@/types/task'

/**
 * 詳細ドロワー用にタスクを正規化する
 * - taskId が無い不正データは null
 */
export function prepareTaskForDetail(
  task: Task | null | undefined,
  resolveAssigneeName: (t: Task) => string,
): Task | null {
  if (!task?.taskId) return null
  const label = resolveAssigneeName(task)
  return {
    ...task,
    assigneeName: label || task.assigneeName,
  }
}

/**
 * クリックで詳細を開くべきか（ドラッグ直後は false）
 */
export function shouldOpenDetailOnPointerUp(options: {
  dragMoved: boolean
  pointerDownTargetIsHandle: boolean
}): boolean {
  if (options.pointerDownTargetIsHandle) return false
  if (options.dragMoved) return false
  return true
}
