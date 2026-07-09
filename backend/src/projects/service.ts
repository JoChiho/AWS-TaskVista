import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { ForbiddenError, NotFoundError, ValidationError } from '../shared/errors.js'
import { canAccessProject, type Project } from '../shared/types.js'
import * as repository from './repository.js'

const createProjectSchema = z.object({
  name: z
    .string({ required_error: 'プロジェクト名は必須項目です' })
    .min(1, 'プロジェクト名は必須項目です')
    .max(100, 'プロジェクト名は100文字以内で入力してください'),
  description: z.string().max(1000).optional(),
})

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  status: z.enum(['active', 'archived']).optional(),
  memberIds: z.array(z.string().min(1)).optional(),
})

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

/** ユーザーがアクセス可能なプロジェクト一覧を取得する */
export async function listProjects(userId: string): Promise<Project[]> {
  const [created, member] = await Promise.all([
    repository.listProjectsByCreator(userId),
    repository.listProjectsByMember(userId),
  ])
  return dedupeProjects([...created, ...member])
}

/** プロジェクト詳細を取得する */
export async function getProject(projectId: string, userId: string): Promise<Project> {
  const project = await repository.getProjectById(projectId)

  if (!project || project.isDeleted) {
    throw new NotFoundError('プロジェクトが見つかりません')
  }

  if (!canAccessProject(project, userId)) {
    throw new ForbiddenError('このプロジェクトへのアクセス権限がありません')
  }

  return project
}

/** プロジェクトを新規作成する */
export async function createProject(
  userId: string,
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
  const project: Project = {
    projectId: uuidv4(),
    name: parsed.data.name,
    description: parsed.data.description,
    status: 'active',
    createdBy: userId,
    memberIds: [userId],
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  }

  return repository.createProject(project)
}

/** プロジェクト情報を更新する */
export async function updateProject(
  projectId: string,
  userId: string,
  body: unknown,
): Promise<Project> {
  await getProject(projectId, userId)

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

/** プロジェクトを論理削除する */
export async function deleteProject(projectId: string, userId: string): Promise<Project> {
  await getProject(projectId, userId)
  return repository.softDeleteProject(projectId)
}