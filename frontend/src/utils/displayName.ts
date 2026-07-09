// 表示名の解決（UI 全体で同じルールを使う）
// 優先順位: 自分のクラウド表示名 > 渡された名前 > メールローカル部 > userId 短縮
import { useAuthStore } from '@/stores/auth'

/**
 * 画面上の人物名を解決する
 * @param userId Cognito sub（分かる場合）
 * @param fallbackName API / スナップショット上の名前（assigneeName, authorName, member.displayName 等）
 * @param email メール（名前が無いときのフォールバック）
 */
export function resolvePersonName(
  userId?: string | null,
  fallbackName?: string | null,
  email?: string | null,
): string {
  const auth = useAuthStore()
  const mySub = auth.currentUser?.sub
  const myCloudName = auth.displayName?.trim()

  // 自分自身なら、常に最新のクラウド表示名を優先（ストアがまだ古いスナップショットでも揃う）
  if (userId && mySub && userId === mySub && myCloudName) {
    return myCloudName
  }

  const name = fallbackName?.trim()
  if (name) return name

  const mail = email?.trim()
  if (mail) {
    const local = mail.split('@')[0]
    return local || mail
  }

  if (userId) return userId.slice(0, 8)
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

/** タスク担当者用の表示名（未割り当ては空文字） */
export function resolveAssigneeDisplayName(task: {
  assigneeId?: string
  assigneeName?: string
}): string {
  if (!task.assigneeId && !task.assigneeName?.trim()) return ''
  return resolvePersonName(task.assigneeId, task.assigneeName)
}

/** コメント投稿者用の表示名 */
export function resolveAuthorDisplayName(comment: {
  authorId?: string
  authorName?: string
}): string {
  return resolvePersonName(comment.authorId, comment.authorName)
}
