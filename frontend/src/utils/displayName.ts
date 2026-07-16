// 表示名の統一解決（UI 全体でこのモジュールだけを使う）
// 優先順位:
//   1. displayNames ストア（userId / email → 人名）
//   2. 現在プロジェクトの members（Pinia state 直読みで循環 import 回避）
//   3. 自分の auth.displayName
//   4. スナップショット fallback（メールは表示しない）
//   5. userId 短縮
import { getActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useDisplayNamesStore } from '@/stores/displayNames'
import type { ProjectMember } from '@/types/project'

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

/** projects ストアを import せずに現在プロジェクトの members を読む */
function getCurrentProjectMembers(): ProjectMember[] {
  try {
    const pinia = getActivePinia()
    if (!pinia) return []
    const state = pinia.state.value as {
      projects?: { currentProject?: { members?: ProjectMember[] } | null }
    }
    return state.projects?.currentProject?.members ?? []
  } catch {
    return []
  }
}

function resolveFromProjectMembers(
  userId?: string | null,
  fallbackName?: string | null,
  email?: string | null,
): string | undefined {
  const members = getCurrentProjectMembers()
  if (members.length === 0) return undefined

  if (userId) {
    const m = members.find((x) => x.userId === userId)
    if (m && isUsableDisplayName(m.displayName)) return m.displayName.trim()
  }
  const mail = (email || (isEmailLike(fallbackName) ? fallbackName : null))?.toLowerCase()
  if (mail) {
    const m = members.find((x) => (x.email || '').toLowerCase() === mail)
    if (m && isUsableDisplayName(m.displayName)) return m.displayName.trim()
  }
  if (isUsableDisplayName(fallbackName)) {
    const name = fallbackName!.trim()
    const m = members.find((x) => (x.displayName || '').trim() === name)
    if (m && isUsableDisplayName(m.displayName)) return m.displayName.trim()
  }
  return undefined
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

  // 1) グローバルディレクトリ
  const fromDir = names.resolveKey(userId, fallbackName, email)
  if (fromDir) return fromDir

  // 2) プロジェクト members 直参照
  const fromMembers = resolveFromProjectMembers(userId, fallbackName, email)
  if (fromMembers) return fromMembers

  // 3) 自分自身
  if (userId && mySub && userId === mySub && isUsableDisplayName(myCloudName)) {
    return myCloudName!
  }

  // 4) スナップショット（メールは除外）
  if (isUsableDisplayName(fallbackName)) {
    return fallbackName!.trim()
  }

  // 5) 最終手段
  if (userId) return userId.slice(0, 8)
  if (isEmailLike(fallbackName) || isEmailLike(email)) {
    const mail = (fallbackName || email || '').trim()
    const local = mail.split('@')[0]
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
 * タスク担当者用の表示名（未割り当ては空文字・主担当）
 * assigneeName がメールでもプロジェクトメンバーの表示名に変換する
 */
export function resolveAssigneeDisplayName(task: {
  assigneeId?: string
  assigneeName?: string
  assignees?: Array<{ userId?: string; displayName?: string }>
}): string {
  const labels = resolveAssigneeLabels(task)
  return labels[0] ?? ''
}

/**
 * 担当者全員の表示名（複数対応）
 * 旧データ（assigneeId/Name のみ）も 1 件配列として返す
 */
export function resolveAssigneeLabels(task: {
  assigneeId?: string
  assigneeName?: string
  assignees?: Array<{ userId?: string; displayName?: string }>
}): string[] {
  const list =
    task.assignees && task.assignees.length > 0
      ? task.assignees
      : task.assigneeId || task.assigneeName?.trim()
        ? [{ userId: task.assigneeId, displayName: task.assigneeName }]
        : []

  if (list.length === 0) return []

  const names = useDisplayNamesStore()
  const out: string[] = []
  const seen = new Set<string>()

  for (const a of list) {
    const emailHint = isEmailLike(a.displayName) ? a.displayName : undefined
    let label =
      names.resolveKey(a.userId, a.displayName, emailHint) ||
      resolveFromProjectMembers(a.userId, a.displayName, emailHint) ||
      resolvePersonName(a.userId, a.displayName, emailHint)

    if (!label?.trim()) continue
    const key = label.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label.trim())
  }
  return out
}

/** 担当者をカンマ区切りで表示（カード・テーブル用） */
export function formatAssigneeList(task: {
  assigneeId?: string
  assigneeName?: string
  assignees?: Array<{ userId?: string; displayName?: string }>
}): string {
  return resolveAssigneeLabels(task).join('、')
}

/** コメント投稿者用の表示名 */
export function resolveAuthorDisplayName(comment: {
  authorId?: string
  authorName?: string
}): string {
  return resolvePersonName(comment.authorId, comment.authorName)
}
