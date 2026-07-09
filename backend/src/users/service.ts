import { z } from 'zod'
import { ValidationError } from '../shared/errors.js'
import * as repository from './repository.js'
import type { UserProfile } from './repository.js'

const updateProfileSchema = z.object({
  displayName: z
    .string({ required_error: '表示名は必須項目です' })
    .min(1, '表示名を入力してください')
    .max(10, '表示名は10文字以内で入力してください'),
})

export interface ActorInfo {
  userId: string
  email?: string
  name: string
}

/** 現在のユーザープロフィールを取得（未作成なら null） */
export async function getMyProfile(actor: ActorInfo): Promise<UserProfile | null> {
  return repository.getProfile(actor.userId)
}

/**
 * 表示名をクラウドに保存（全端末・全ユーザーから同じ名前が見える）
 */
export async function updateMyProfile(
  actor: ActorInfo,
  body: unknown,
): Promise<UserProfile> {
  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'displayName'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  const now = new Date().toISOString()
  const existing = await repository.getProfile(actor.userId)
  const profile: UserProfile = {
    userId: actor.userId,
    email: actor.email || existing?.email,
    displayName: parsed.data.displayName.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return repository.putProfile(profile)
}

/** 複数 userId の表示名マップ */
export async function getDisplayNameMap(
  userIds: string[],
): Promise<Map<string, string>> {
  const profiles = await repository.batchGetProfiles(userIds)
  const map = new Map<string, string>()
  for (const [id, p] of profiles) {
    if (p.displayName?.trim()) map.set(id, p.displayName.trim())
  }
  return map
}

export async function getDisplayName(userId: string): Promise<string | null> {
  const p = await repository.getProfile(userId)
  return p?.displayName?.trim() || null
}
