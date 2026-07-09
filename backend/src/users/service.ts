import { z } from 'zod'
import { ValidationError } from '../shared/errors.js'
import * as projectRepository from '../projects/repository.js'
import * as taskRepository from '../tasks/repository.js'
import * as repository from './repository.js'
import type { UserProfile } from './repository.js'

const updateProfileSchema = z.object({
  displayName: z
    .string({ required_error: '表示名は必須項目です' })
    .min(1, '表示名を入力してください')
    .max(100, '表示名は100文字以内で入力してください'),
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
      fields[issue.path.join('.') || 'displayName'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  const now = new Date().toISOString()
  const existing = await repository.getProfile(actor.userId)
  const displayName = parsed.data.displayName.trim()
  const profile: UserProfile = {
    userId: actor.userId,
    email: actor.email || existing?.email,
    displayName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await repository.putProfile(profile)

  // プロジェクト members / タスク assigneeName のスナップショットも更新
  // （フロントが古いキャッシュを持っていても、再取得で最新名になる）
  try {
    await syncDisplayNameAcrossRecords(actor.userId, displayName)
  } catch (e) {
    console.error('表示名の関連データ同期に失敗（プロフィール自体は保存済み）:', e)
  }

  return profile
}

/**
 * この userId が登場するプロジェクト・タスクの表示名を一括更新
 */
async function syncDisplayNameAcrossRecords(
  userId: string,
  displayName: string,
): Promise<void> {
  // 1) 自分が作成した or メンバーのプロジェクト
  const [created, memberOf] = await Promise.all([
    projectRepository.listProjectsByCreator(userId),
    projectRepository.listProjectsByMember(userId),
  ])
  const projectsMap = new Map<string, (typeof created)[0]>()
  for (const p of [...created, ...memberOf]) {
    if (!p.isDeleted) projectsMap.set(p.projectId, p)
  }

  await Promise.all(
    [...projectsMap.values()].map(async (project) => {
      const members = (project.members ?? []).map((m) =>
        m.userId === userId ? { ...m, displayName } : m,
      )
      // members に userId が無い古いデータでも memberIds にいれば足す
      if (
        project.memberIds.includes(userId) &&
        !members.some((m) => m.userId === userId)
      ) {
        members.push({
          userId,
          email: '',
          displayName,
        })
      }
      const changed = (project.members ?? []).some(
        (m) => m.userId === userId && m.displayName !== displayName,
      )
      if (changed || !(project.members ?? []).some((m) => m.userId === userId)) {
        await projectRepository.updateProject(project.projectId, { members })
      }
    }),
  )

  // 2) 担当タスクの assigneeName
  const assigned = await taskRepository.listTasksByAssignee(userId)
  await Promise.all(
    assigned
      .filter((t) => !t.isDeleted && t.assigneeName !== displayName)
      .map((t) =>
        taskRepository.updateTask(t.taskId, { assigneeName: displayName }),
      ),
  )
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
