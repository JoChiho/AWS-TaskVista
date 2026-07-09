import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { findCognitoUserByEmail } from '../shared/cognito.js'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import {
  canAccessProject,
  type Project,
  type ProjectMember,
} from '../shared/types.js'
import * as repository from './repository.js'

const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'プロジェクト名は必須項目です' })
    .min(1, 'プロジェクト名は必須項目です')
    .max(100, 'プロジェクト名は100文字以内で入力してください'),
  description: z.string().max(1000).optional(),
  /** 作成者の表示名（フロントのプロフィール名） */
  creatorDisplayName: z.string().min(1).max(100).optional(),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
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
      members.push({
        userId: actor.userId,
        email,
        displayName: actor.name || email,
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
  return dedupeProjects(bound)
}

/** プロジェクト詳細を取得する */
export async function getProject(projectId: string, actor: ActorInfo): Promise<Project> {
  return getAccessibleProject(projectId, actor)
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
  // 表示名はフロントで設定した氏名を最優先（Cognito の乱数 ID を使わない）
  const displayName =
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
    status: 'active',
    createdBy: actor.userId,
    memberIds: [actor.userId],
    memberEmails: [email],
    members: [creatorMember],
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }

  return repository.createProject(project)
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

  return repository.updateProject(projectId, parsed.data)
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

/** プロジェクトメンバーを追加する（確認不要・即時アクセス可能） */
export async function addProjectMember(
  projectId: string,
  actor: ActorInfo,
  body: unknown,
): Promise<Project> {
  const project = await getAccessibleProject(projectId, actor)

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
  const displayName =
    parsed.data.displayName?.trim() ||
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

  // 作成者メタデータ（表示名は actor が作成者なら最新名を使う）
  const creatorEmail =
    actor.userId === project.createdBy && actor.email
      ? normalizeEmail(actor.email)
      : members.find((m) => m.userId === project.createdBy)?.email ||
        `${project.createdBy}@unknown.local`
  const creatorDisplayName =
    actor.userId === project.createdBy
      ? actor.name || creatorEmail
      : members.find((m) => m.userId === project.createdBy)?.displayName || 'オーナー'

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

  return repository.updateProject(projectId, {
    members,
    memberEmails: Array.from(memberEmails),
    memberIds: Array.from(memberIds),
  })
}

/** プロジェクトメンバーを削除する */
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

  const removedEmails = new Set(removed.map((m) => normalizeEmail(m.email)))
  if (key.includes('@')) removedEmails.add(keyLower)

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
    nextMembers.unshift(
      creator || {
        userId: project.createdBy,
        email: actor.userId === project.createdBy && actor.email
          ? normalizeEmail(actor.email)
          : `${project.createdBy}@unknown.local`,
        displayName: actor.userId === project.createdBy ? actor.name : 'オーナー',
      },
    )
  }

  return repository.updateProject(projectId, {
    members: nextMembers,
    memberIds: [...new Set(memberIds)],
    memberEmails: [...new Set(memberEmails)],
  })
}

/** プロジェクトを論理削除する */
export async function deleteProject(projectId: string, actor: ActorInfo): Promise<Project> {
  await getAccessibleProject(projectId, actor)
  return repository.softDeleteProject(projectId)
}
