import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { findCognitoUserByEmail } from '../shared/cognito.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import {
  canAccessProject,
  type Project,
  type ProjectMember,
} from '../shared/types.js'
import * as usersService from '../users/service.js'
import * as taskRepository from '../tasks/repository.js'
import * as repository from './repository.js'

const projectStatusSchema = z.enum([
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
])

const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'プロジェクト名は必須項目です' })
    .min(1, 'プロジェクト名は必須項目です')
    .max(100, 'プロジェクト名は100文字以内で入力してください'),
  description: z.string().max(1000).optional(),
  status: projectStatusSchema.optional(),
  /** 作成者の表示名（フロントのプロフィール名） */
  creatorDisplayName: z.string().min(1).max(100).optional(),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  status: projectStatusSchema.optional(),
  memberIds: z.array(z.string().min(1)).optional(),
})

const addMemberSchema = z.object({
  email: z
    .string({ required_error: 'メールアドレスは必須項目です' })
    .email('有効なメールアドレスを入力してください')
    .max(256),
  displayName: z.string().min(1).max(100).optional(),
})

export interface ActorInfo {
  userId: string
  email?: string
  name: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * メンバー表示名を TaskVista-Users の最新値で上書き
 * - 全メンバー（他ユーザー含む）が同じ表示名を見る
 * - memberIds にあるが members に無い userId も補完する
 */
async function enrichProjectMembers(project: Project): Promise<Project> {
  const idSet = new Set<string>()
  if (project.createdBy) idSet.add(project.createdBy)
  for (const id of project.memberIds ?? []) {
    if (id) idSet.add(id)
  }
  for (const m of project.members ?? []) {
    if (m.userId) idSet.add(m.userId)
  }

  const names = await usersService.getDisplayNameMap([...idSet])

  // userId 付きメンバーをマップ化（クラウド表示名を優先）
  const byUserId = new Map<string, ProjectMember>()
  const emailOnly: ProjectMember[] = []

  for (const m of project.members ?? []) {
    if (!m.userId) {
      emailOnly.push(m)
      continue
    }
    const cloud = names.get(m.userId)
    byUserId.set(m.userId, {
      ...m,
      displayName: cloud || m.displayName || m.email || m.userId.slice(0, 8),
    })
  }

  // memberIds / createdBy にいるが members に無い人を補完
  for (const id of idSet) {
    if (byUserId.has(id)) continue
    const cloud = names.get(id)
    byUserId.set(id, {
      userId: id,
      email: '',
      displayName: cloud || id.slice(0, 8),
    })
  }

  // 作成者を先頭に
  const rest = [...byUserId.values()].filter((m) => m.userId !== project.createdBy)
  const creator = byUserId.get(project.createdBy)
  const members = [
    ...(creator ? [creator] : []),
    ...rest,
    ...emailOnly,
  ]

  return { ...project, members }
}

async function enrichProjects(projects: Project[]): Promise<Project[]> {
  return Promise.all(projects.map((p) => enrichProjectMembers(p)))
}

function dedupeProjects(projects: Project[]): Project[] {
  const map = new Map<string, Project>()
  for (const project of projects) {
    if (!project.isDeleted) {
      map.set(project.projectId, project)
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/** 招待メールでアクセスした場合、userId を memberIds に紐づける */
async function bindMemberIfNeeded(project: Project, actor: ActorInfo): Promise<Project> {
  const email = actor.email ? normalizeEmail(actor.email) : undefined
  if (!canAccessProject(project, actor.userId, email)) {
    return project
  }

  const members: ProjectMember[] = [...(project.members ?? [])]
  const memberIds = new Set(project.memberIds)
  const memberEmails = new Set(
    (project.memberEmails ?? []).map((e) => normalizeEmail(e)),
  )
  let changed = false

  for (const member of members) {
    const memberEmail = normalizeEmail(member.email)
    if (
      email &&
      memberEmail === email &&
      member.userId !== actor.userId
    ) {
      member.userId = actor.userId
      changed = true
    }
  }

  if (!memberIds.has(actor.userId)) {
    // メール招待済み、または既に members に userId がある場合のみ追加
    const invited =
      (email && memberEmails.has(email)) ||
      members.some((m) => m.userId === actor.userId || (email && normalizeEmail(m.email) === email))
    if (invited || project.createdBy === actor.userId) {
      memberIds.add(actor.userId)
      changed = true
    }
  }

  if (email && !memberEmails.has(email) && (project.createdBy === actor.userId || memberIds.has(actor.userId))) {
    memberEmails.add(email)
    if (!members.some((m) => normalizeEmail(m.email) === email)) {
      const cloudName = await usersService.getDisplayName(actor.userId)
      members.push({
        userId: actor.userId,
        email,
        displayName: cloudName || actor.name || email,
      })
      changed = true
    }
  }

  if (!changed) return project

  return repository.updateProject(project.projectId, {
    memberIds: Array.from(memberIds),
    memberEmails: Array.from(memberEmails),
    members,
  })
}

async function getAccessibleProject(projectId: string, actor: ActorInfo): Promise<Project> {
  const project = await repository.getProjectById(projectId)

  if (!project || project.isDeleted) {
    throw new NotFoundError('プロジェクトが見つかりません')
  }

  if (!canAccessProject(project, actor.userId, actor.email)) {
    throw new ForbiddenError('このプロジェクトへのアクセス権限がありません')
  }

  return bindMemberIfNeeded(project, actor)
}

/** ユーザーがアクセス可能なプロジェクト一覧を取得する */
export async function listProjects(actor: ActorInfo): Promise<Project[]> {
  const email = actor.email ? normalizeEmail(actor.email) : undefined
  const [created, member, byEmail] = await Promise.all([
    repository.listProjectsByCreator(actor.userId),
    repository.listProjectsByMember(actor.userId),
    email ? repository.listProjectsByMemberEmail(email) : Promise.resolve([]),
  ])

  const projects = dedupeProjects([...created, ...member, ...byEmail])
  const bound = await Promise.all(projects.map((p) => bindMemberIfNeeded(p, actor)))
  return enrichProjects(dedupeProjects(bound))
}

/** プロジェクト詳細を取得する */
export async function getProject(projectId: string, actor: ActorInfo): Promise<Project> {
  const project = await getAccessibleProject(projectId, actor)
  return enrichProjectMembers(project)
}

/** プロジェクトを新規作成する */
export async function createProject(
  actor: ActorInfo,
  body: unknown,
): Promise<Project> {
  const parsed = createProjectSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'body'
      fields[key] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  const now = new Date().toISOString()
  const email = actor.email ? normalizeEmail(actor.email) : `${actor.userId}@unknown.local`
  // 表示名: クラウドプロフィール > リクエスト > Cognito 以外の名前
  const cloudName = await usersService.getDisplayName(actor.userId)
  const displayName =
    cloudName ||
    parsed.data.creatorDisplayName?.trim() ||
    (actor.name && !actor.name.includes('-') && actor.name !== 'ユーザー'
      ? actor.name
      : null) ||
    (actor.email ? actor.email.split('@')[0] : null) ||
    'ユーザー'

  const creatorMember: ProjectMember = {
    userId: actor.userId,
    email,
    displayName,
  }

  const project: Project = {
    projectId: uuidv4(),
    name: parsed.data.name,
    description: parsed.data.description,
    status: parsed.data.status ?? 'active',
    createdBy: actor.userId,
    memberIds: [actor.userId],
    memberEmails: [email],
    members: [creatorMember],
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }

  const created = await repository.createProject(project)
  return enrichProjectMembers(created)
}

/** プロジェクト情報を更新する */
export async function updateProject(
  projectId: string,
  actor: ActorInfo,
  body: unknown,
): Promise<Project> {
  await getAccessibleProject(projectId, actor)

  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'body'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  if (Object.keys(parsed.data).length === 0) {
    throw new ValidationError('更新する項目が指定されていません')
  }

  const updated = await repository.updateProject(projectId, parsed.data)
  return enrichProjectMembers(updated)
}

/** メンバー配列を userId / email で重複排除する */
function dedupeMembers(members: ProjectMember[]): ProjectMember[] {
  const byKey = new Map<string, ProjectMember>()
  for (const m of members) {
    const email = normalizeEmail(m.email || '')
    const key = m.userId || email
    if (!key) continue
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...m, email: email || m.email })
      continue
    }
    // 既存とマージ（userId・きれいな表示名を優先）
    byKey.set(key, {
      userId: prev.userId || m.userId,
      email: email || prev.email,
      displayName:
        m.displayName && m.displayName !== 'ユーザー' && m.displayName !== 'オーナー'
          ? m.displayName
          : prev.displayName || m.displayName,
    })
  }
  // email キーと userId キーで二重になった同一人物を再統合
  const byUser = new Map<string, ProjectMember>()
  for (const m of byKey.values()) {
    const k = m.userId || normalizeEmail(m.email)
    const prev = byUser.get(k)
    if (!prev) {
      byUser.set(k, m)
    } else {
      byUser.set(k, {
        userId: prev.userId || m.userId,
        email: normalizeEmail(prev.email || m.email),
        displayName: prev.displayName || m.displayName,
      })
    }
  }
  return Array.from(byUser.values())
}

/** プロジェクトメンバーを追加する（オーナーのみ・確認不要・即時アクセス可能） */
export async function addProjectMember(
  projectId: string,
  actor: ActorInfo,
  body: unknown,
): Promise<Project> {
  const project = await getAccessibleProject(projectId, actor)

  // メンバー追加はプロジェクトオーナーのみ
  if (actor.userId !== project.createdBy) {
    throw new ForbiddenError('メンバーの追加はプロジェクトオーナーのみ可能です')
  }

  const parsed = addMemberSchema.safeParse(body)
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fields[issue.path.join('.') || 'body'] = issue.message
    }
    throw new ValidationError('入力内容をご確認ください', fields)
  }

  const email = normalizeEmail(parsed.data.email)

  // Cognito 上の既存ユーザーを検索し、見つかれば sub を即時 memberIds に入れる
  const cognitoUser = await findCognitoUserByEmail(email)
  if (!cognitoUser) {
    throw new ValidationError(
      'このメールアドレスのユーザーが Cognito ユーザープールに見つかりません。先に Cognito でユーザーを作成してから招待してください。',
      { email: 'ユーザープールに未登録のメールです' },
    )
  }

  const resolvedUserId = cognitoUser.userId
  const cloudName = await usersService.getDisplayName(resolvedUserId)
  const displayName =
    parsed.data.displayName?.trim() ||
    cloudName ||
    cognitoUser.displayName ||
    email.split('@')[0] ||
    email

  // 作成者自身の追加は拒否（表示が二重になるのを防ぐ）
  if (
    resolvedUserId === project.createdBy ||
    (actor.email && normalizeEmail(actor.email) === email && actor.userId === project.createdBy)
  ) {
    throw new ValidationError('プロジェクト作成者は既にメンバーです', {
      email: '作成者は追加できません',
    })
  }

  // 既に参加済み
  const alreadyMember =
    project.memberIds.includes(resolvedUserId) ||
    (project.memberEmails ?? []).map(normalizeEmail).includes(email) ||
    (project.members ?? []).some(
      (m) => m.userId === resolvedUserId || normalizeEmail(m.email) === email,
    )
  if (alreadyMember) {
    throw new ValidationError('このユーザーは既にプロジェクトメンバーです', {
      email: '既に追加済みです',
    })
  }

  let members = dedupeMembers([...(project.members ?? [])])
  const memberEmails = new Set(
    (project.memberEmails ?? []).map(normalizeEmail).filter((e) => !e.endsWith('@unknown.local')),
  )
  const memberIds = new Set(project.memberIds)
  memberIds.add(project.createdBy)

  // 作成者メタデータ（表示名はクラウドプロフィールを最優先）
  const creatorEmail =
    actor.userId === project.createdBy && actor.email
      ? normalizeEmail(actor.email)
      : members.find((m) => m.userId === project.createdBy)?.email ||
        `${project.createdBy}@unknown.local`
  const creatorCloudName = await usersService.getDisplayName(project.createdBy)
  const creatorDisplayName =
    creatorCloudName ||
    (actor.userId === project.createdBy
      ? actor.name || creatorEmail
      : members.find((m) => m.userId === project.createdBy)?.displayName || 'オーナー')

  members = members.filter(
    (m) => m.userId !== project.createdBy && normalizeEmail(m.email) !== creatorEmail,
  )
  members.unshift({
    userId: project.createdBy,
    email: creatorEmail,
    displayName: creatorDisplayName,
  })
  if (!creatorEmail.endsWith('@unknown.local')) {
    memberEmails.add(creatorEmail)
  }

  members.push({
    userId: resolvedUserId,
    email,
    displayName,
  })
  memberEmails.add(email)
  memberIds.add(resolvedUserId)

  members = dedupeMembers(members)

  const updated = await repository.updateProject(projectId, {
    members,
    memberEmails: Array.from(memberEmails),
    memberIds: Array.from(memberIds),
  })
  return enrichProjectMembers(updated)
}

/**
 * プロジェクトメンバーを削除する
 * - オーナー: 他メンバーを削除可能
 * - 一般メンバー: 自分自身の退出のみ可能
 * - オーナー自身は削除・退出不可
 */
export async function removeProjectMember(
  projectId: string,
  actor: ActorInfo,
  emailOrUserId: string,
): Promise<Project> {
  const project = await getAccessibleProject(projectId, actor)
  let key = emailOrUserId.trim()
  try {
    key = decodeURIComponent(key)
  } catch {
    // 既にデコード済みの場合はそのまま
  }
  const keyLower = key.toLowerCase()
  const actorEmail = actor.email ? normalizeEmail(actor.email) : undefined

  // 作成者（sub または 作成者メール）は削除不可
  const creatorEmails = new Set(
    (project.members ?? [])
      .filter((m) => m.userId === project.createdBy)
      .map((m) => normalizeEmail(m.email)),
  )
  if (key === project.createdBy || creatorEmails.has(keyLower)) {
    throw new ValidationError('プロジェクト作成者はメンバーから削除できません')
  }

  const before = project.members ?? []
  // 削除対象が誰かを先に特定（権限判定用）
  const targetMembers = before.filter((m) => {
    if (m.userId && (m.userId === key || m.userId === keyLower)) return true
    if (m.email && normalizeEmail(m.email) === keyLower) return true
    return false
  })
  const targetIsSelf =
    targetMembers.some((m) => m.userId === actor.userId) ||
    (!!actorEmail && keyLower === actorEmail) ||
    key === actor.userId ||
    keyLower === actor.userId.toLowerCase()

  const isOwner = actor.userId === project.createdBy
  if (!isOwner && !targetIsSelf) {
    throw new ForbiddenError(
      '他のメンバーの削除はプロジェクトオーナーのみ可能です。自分自身の退出のみ行えます。',
    )
  }

  const members = before.filter((m) => {
    if (m.userId && (m.userId === key || m.userId === keyLower)) return false
    if (m.email && normalizeEmail(m.email) === keyLower) return false
    return true
  })

  const removed = before.filter((m) => !members.includes(m))
  const alsoInIds = project.memberIds.includes(key)
  const alsoInEmails = (project.memberEmails ?? []).map(normalizeEmail).includes(keyLower)

  if (removed.length === 0 && !alsoInIds && !alsoInEmails) {
    throw new NotFoundError('メンバーが見つかりません')
  }

  const removedUserIds = new Set(removed.map((m) => m.userId).filter(Boolean) as string[])
  if (key && !key.includes('@')) removedUserIds.add(key)
  // 自分退出時は actor.userId も必ず含める
  if (targetIsSelf) removedUserIds.add(actor.userId)

  const removedEmails = new Set(removed.map((m) => normalizeEmail(m.email)))
  if (key.includes('@')) removedEmails.add(keyLower)
  if (targetIsSelf && actorEmail) removedEmails.add(actorEmail)

  // 作成者は必ず残す
  const memberIds = [
    project.createdBy,
    ...project.memberIds.filter(
      (id) => id !== project.createdBy && !removedUserIds.has(id),
    ),
  ]

  const memberEmails = (project.memberEmails ?? [])
    .map(normalizeEmail)
    .filter((e) => !removedEmails.has(e) && !e.endsWith('@unknown.local'))

  // 作成者エントリが消えていたら戻す
  let nextMembers = dedupeMembers(members)
  if (!nextMembers.some((m) => m.userId === project.createdBy)) {
    const creator = before.find((m) => m.userId === project.createdBy)
    const creatorCloud = await usersService.getDisplayName(project.createdBy)
    nextMembers.unshift(
      creator
        ? {
            ...creator,
            displayName: creatorCloud || creator.displayName,
          }
        : {
            userId: project.createdBy,
            email:
              actor.userId === project.createdBy && actor.email
                ? normalizeEmail(actor.email)
                : `${project.createdBy}@unknown.local`,
            displayName:
              creatorCloud ||
              (actor.userId === project.createdBy ? actor.name : 'オーナー'),
          },
    )
  }

  const updated = await repository.updateProject(projectId, {
    members: nextMembers,
    memberIds: [...new Set(memberIds)],
    memberEmails: [...new Set(memberEmails)],
  })

  // 退出・削除されたユーザーの未完了タスクから担当を外す
  try {
    await clearAssigneesForRemovedUsers(projectId, removedUserIds)
  } catch (e) {
    console.error('メンバー削除後の担当クリアに失敗（メンバー削除自体は完了）:', e)
  }

  return enrichProjectMembers(updated)
}

/**
 * プロジェクト内の未完了タスクから、退出メンバーを担当から外す
 * - 単独担当なら未割り当て
 * - 複数担当なら当該メンバーのみ除去
 */
async function clearAssigneesForRemovedUsers(
  projectId: string,
  removedUserIds: Set<string>,
): Promise<void> {
  if (removedUserIds.size === 0) return
  const tasks = await taskRepository.listTasksByProject(projectId)
  const jobs: Promise<unknown>[] = []
  for (const t of tasks) {
    if (t.isDeleted || t.status === '完了') continue
    for (const uid of removedUserIds) {
      const isPrimary = t.assigneeId === uid
      const inList = t.assignees?.some((a) => a.userId === uid)
      if (isPrimary || inList) {
        jobs.push(taskRepository.removeAssigneeUser(t.taskId, uid))
      }
    }
  }
  await Promise.all(jobs)
}

/** プロジェクトを論理削除する */
export async function deleteProject(projectId: string, actor: ActorInfo): Promise<Project> {
  await getAccessibleProject(projectId, actor)
  return repository.softDeleteProject(projectId)
}
