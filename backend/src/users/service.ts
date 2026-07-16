import { z } from 'zod'
import { ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import * as taskRepository from '../tasks/repository.js'
import * as repository from './repository.js'
import type { UserProfile } from './repository.js'

const namePartSchema = z
  .string()
  .trim()
  .min(1, '入力してください')
  .max(50, '50 文字以内で入力してください')

/**
 * 姓・名を受け取る（推奨）
 * 後方互換: displayName のみも許可し、空白で姓/名に分割
 */
const updateProfileSchema = z
  .object({
    familyName: namePartSchema.optional(),
    givenName: namePartSchema.optional(),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),
  })
  .superRefine((data, ctx) => {
    const hasParts = !!data.familyName && !!data.givenName
    const hasLegacy = !!data.displayName
    if (!hasParts && !hasLegacy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '姓と名を入力してください',
        path: ['familyName'],
      })
    }
  })

export interface ActorInfo {
  userId: string
  email?: string
  name: string
}

/** フルネーム組み立て（日本語: 姓 名） */
export function composeDisplayName(familyName: string, givenName: string): string {
  return `${familyName.trim()} ${givenName.trim()}`.trim()
}

/**
 * 旧データや displayName のみから姓・名を推定
 * 「姓 名」形式なら空白で分割、なければ全体を姓とする
 */
export function splitDisplayName(displayName: string): {
  familyName: string
  givenName: string
} {
  const t = displayName.trim().replace(/\s+/g, ' ')
  if (!t) return { familyName: '', givenName: '' }
  const sp = t.indexOf(' ')
  if (sp === -1) {
    return { familyName: t, givenName: '' }
  }
  return {
    familyName: t.slice(0, sp).trim(),
    givenName: t.slice(sp + 1).trim(),
  }
}

/** 現在のユーザープロフィールを取得（未作成なら null） */
export async function getMyProfile(actor: ActorInfo): Promise<UserProfile | null> {
  const p = await repository.getProfile(actor.userId)
  if (!p) return null
  // 旧データ補完
  if (!p.familyName && p.displayName) {
    const parts = splitDisplayName(p.displayName)
    return { ...p, familyName: parts.familyName, givenName: parts.givenName }
  }
  return p
}

/**
 * 表示名をクラウドに保存し、関連するプロジェクトメンバー名・担当者名も同期する
 */
export async function updateMyProfile(
  actor: ActorInfo,
  body: unknown,
): Promise<UserProfile> {
  const parsed = updateProfileSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'familyName'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  let familyName = parsed.data.familyName?.trim() || ''
  let givenName = parsed.data.givenName?.trim() || ''

  if (!familyName || !givenName) {
    // 後方互換: displayName のみ
    const parts = splitDisplayName(parsed.data.displayName || '')
    familyName = familyName || parts.familyName
    givenName = givenName || parts.givenName
  }

  if (!familyName) {
    throw new ValidationError('入力内容をご確認ください', {
      familyName: '姓を入力してください',
    })
  }
  // 名が空でも姓のみは許可（旧データ互換）— ただし新規 UI は両方必須
  if (!givenName && !parsed.data.displayName) {
    throw new ValidationError('入力内容をご確認ください', {
      givenName: '名を入力してください',
    })
  }

  const displayName = givenName
    ? composeDisplayName(familyName, givenName)
    : familyName

  const now = new Date().toISOString()
  const existing = await repository.getProfile(actor.userId)
  const profile: UserProfile = {
    userId: actor.userId,
    email: actor.email || existing?.email,
    displayName,
    familyName,
    givenName: givenName || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await repository.putProfile(profile)

  try {
    await syncDisplayNameAcrossRecords(actor.userId, displayName, actor.email)
  } catch (e) {
    console.error('表示名の関連データ同期に失敗（プロフィール自体は保存済み）:', e)
  }

  return profile
}

/**
 * この userId（および email）が登場するプロジェクト・タスクの表示名を一括更新
 */
async function syncDisplayNameAcrossRecords(
  userId: string,
  displayName: string,
  email?: string,
): Promise<void> {
  const emailNorm = email?.trim().toLowerCase()

  const [created, memberOf, byEmail] = await Promise.all([
    projectRepository.listProjectsByCreator(userId),
    projectRepository.listProjectsByMember(userId),
    emailNorm
      ? projectRepository.listProjectsByMemberEmail(emailNorm)
      : Promise.resolve([]),
  ])
  const projectsMap = new Map<string, (typeof created)[0]>()
  for (const p of [...created, ...memberOf, ...byEmail]) {
    if (!p.isDeleted) projectsMap.set(p.projectId, p)
  }

  await Promise.all(
    [...projectsMap.values()].map(async (project) => {
      let touched = false
      const members = (project.members ?? []).map((m) => {
        const sameUser =
          m.userId === userId ||
          (!!emailNorm && (m.email || '').trim().toLowerCase() === emailNorm)
        if (!sameUser) return m
        if (m.displayName === displayName && m.userId === userId) return m
        touched = true
        return {
          ...m,
          userId: m.userId || userId,
          displayName,
        }
      })

      if (
        project.memberIds.includes(userId) &&
        !members.some((m) => m.userId === userId)
      ) {
        members.push({
          userId,
          email: emailNorm || '',
          displayName,
        })
        touched = true
      }

      let memberIds = project.memberIds
      if (!memberIds.includes(userId)) {
        const invitedByEmail =
          !!emailNorm &&
          ((project.memberEmails ?? []).map((e) => e.toLowerCase()).includes(emailNorm) ||
            (project.members ?? []).some(
              (m) => (m.email || '').toLowerCase() === emailNorm,
            ))
        if (invitedByEmail || project.createdBy === userId) {
          memberIds = [...memberIds, userId]
          touched = true
        }
      }

      if (touched) {
        await projectRepository.updateProject(project.projectId, {
          members,
          memberIds,
        })
      }
    }),
  )

  const assigned = await taskRepository.listTasksByAssignee(userId)
  await Promise.all(
    assigned
      .filter((t) => !t.isDeleted)
      .map((t) => {
        const assignees = (t.assignees && t.assignees.length > 0
          ? t.assignees
          : t.assigneeId || t.assigneeName
            ? [{ userId: t.assigneeId, displayName: t.assigneeName || displayName }]
            : []
        ).map((a) =>
          a.userId === userId ? { ...a, displayName } : a,
        )
        const primary = assignees[0]
        return taskRepository.updateTask(t.taskId, {
          assigneeName:
            t.assigneeId === userId ? displayName : primary?.displayName || t.assigneeName,
          assignees,
        })
      }),
  )
}

/** 複数 userId の表示名マップ（フルネーム） */
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

/**
 * フルネームと姓の両方を返す（アバターは姓のみ表示）
 */
export async function getDisplayNamePartsMap(
  userIds: string[],
): Promise<{
  names: Map<string, string>
  familyNames: Map<string, string>
}> {
  const profiles = await repository.batchGetProfiles(userIds)
  const names = new Map<string, string>()
  const familyNames = new Map<string, string>()
  for (const [id, p] of profiles) {
    if (p.displayName?.trim()) names.set(id, p.displayName.trim())
    const family =
      p.familyName?.trim() ||
      (p.displayName ? splitDisplayName(p.displayName).familyName : '')
    if (family) familyNames.set(id, family)
  }
  return { names, familyNames }
}

export async function getDisplayName(userId: string): Promise<string | null> {
  const p = await repository.getProfile(userId)
  return p?.displayName?.trim() || null
}
