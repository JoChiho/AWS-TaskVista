// 表示名の統一解決（UI 全体でこのモジュールだけを使う）
// 優先順位:
//   1. displayNames ストア（userId / email → 人名。メンバー表・クラウドから）
//   2. 自分の auth.displayName
//   3. スナップショット fallback（ただしメール文字列は表示しない）
//   4. userId 短縮
import { useAuthStore } from '@/stores/auth'
import { useDisplayNamesStore } from '@/stores/displayNames'

function isEmailLike(value: string | undefined | null): boolean {
  return !!value && value.includes('@')
}

function isUsableDisplayName(value: string | undefined | null): boolean {
  const n = value?.trim()
  if (!n) return false
  if (isEmailLike(n)) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n)) {
    return false
  }
  return true
}

/**
 * 画面上の人物名を解決する（自分・他人とも同じルール）
 * メールアドレスは表示名として使わない
 */
export function resolvePersonName(
  userId?: string | null,
  fallbackName?: string | null,
  email?: string | null,
): string {
  const auth = useAuthStore()
  const names = useDisplayNamesStore()
  const mySub = auth.currentUser?.sub
  const myCloudName = auth.displayName?.trim()

  // 1) グローバルディレクトリ（userId / email の両方）
  const fromDir = names.resolveKey(userId, fallbackName, email)
  if (fromDir) return fromDir

  // 2) 自分自身
  if (userId && mySub && userId === mySub && isUsableDisplayName(myCloudName)) {
    return myCloudName!
  }

  // 3) スナップショット（メールは除外）
  if (isUsableDisplayName(fallbackName)) {
    return fallbackName!.trim()
  }

  // 4) メールローカル部は使わず、userId 短縮のみ（メール全文は出さない）
  if (userId) return userId.slice(0, 8)
  if (isEmailLike(fallbackName) || isEmailLike(email)) {
    const mail = (fallbackName || email || '').trim()
    const local = mail.split('@')[0]
    // 最終手段: ローカル部のみ（フルメールは UI に出さない）
    return local || 'ユーザー'
  }
  return 'ユーザー'
}

/** プロジェクトメンバー用の表示名 */
export function resolveMemberDisplayName(member: {
  userId?: string
  displayName?: string
  email?: string
}): string {
  return resolvePersonName(member.userId, member.displayName, member.email)
}

/**
 * タスク担当者用の表示名（未割り当ては空文字）
 * assigneeName がメールでもプロジェクトメンバーの表示名に変換する
 */
export function resolveAssigneeDisplayName(task: {
  assigneeId?: string
  assigneeName?: string
}): string {
  if (!task.assigneeId && !task.assigneeName?.trim()) return ''

  const names = useDisplayNamesStore()
  // assigneeName がメールのケースを明示的に解決
  const emailHint = isEmailLike(task.assigneeName) ? task.assigneeName : undefined
  const resolved = names.resolveKey(task.assigneeId, task.assigneeName, emailHint)
  if (resolved) return resolved

  return resolvePersonName(task.assigneeId, task.assigneeName, emailHint)
}

/** コメント投稿者用の表示名 */
export function resolveAuthorDisplayName(comment: {
  authorId?: string
  authorName?: string
}): string {
  return resolvePersonName(comment.authorId, comment.authorName)
}
