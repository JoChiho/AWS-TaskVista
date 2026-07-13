// 全ユーザー表示名ディレクトリ（自分・他人を統一解決）
// API が返す members / assignee / author を取り込み、UI は必ずここ経由で名前を出す
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Project, ProjectMember } from '@/types/project'
import type { Task } from '@/types/task'
import type { Comment } from '@/types/comment'
import * as usersApi from '@/api/users'

function isEmailLike(value: string | undefined | null): boolean {
  return !!value && value.includes('@')
}

/** メールアドレスらしい文字列を人名として採用しない */
function isUsableDisplayName(value: string | undefined | null): boolean {
  const n = value?.trim()
  if (!n) return false
  if (isEmailLike(n)) return false
  // Cognito sub っぽい UUID も表示名にしない
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n)) {
    return false
  }
  return true
}

export const useDisplayNamesStore = defineStore('displayNames', () => {
  /** userId (Cognito sub) → クラウド表示名 */
  const byUserId = ref<Record<string, string>>({})
  /** email (lower) → 表示名（タスクの assigneeName がメールのときの解決用） */
  const byEmail = ref<Record<string, string>>({})
  /** email (lower) → userId */
  const userIdByEmail = ref<Record<string, string>>({})

  /**
   * userId → 表示名を登録
   * 既存が「人名」で新規がメールの場合は上書きしない（タスク snapshot 汚染防止）
   */
  function setName(userId: string | undefined | null, name: string | undefined | null): void {
    const id = userId?.trim()
    const n = name?.trim()
    if (!id || !n) return

    const existing = byUserId.value[id]
    if (existing && isUsableDisplayName(existing) && !isUsableDisplayName(n)) {
      return
    }
    if (!isUsableDisplayName(n) && existing) {
      return
    }
    if (existing === n) return
    byUserId.value = { ...byUserId.value, [id]: n }
  }

  function setEmailName(
    email: string | undefined | null,
    name: string | undefined | null,
    userId?: string | null,
  ): void {
    const em = email?.trim().toLowerCase()
    const n = name?.trim()
    if (!em || !n || !isUsableDisplayName(n)) return
    if (byEmail.value[em] !== n) {
      byEmail.value = { ...byEmail.value, [em]: n }
    }
    if (userId?.trim()) {
      userIdByEmail.value = { ...userIdByEmail.value, [em]: userId.trim() }
    }
  }

  function getName(userId?: string | null): string | undefined {
    if (!userId) return undefined
    const n = byUserId.value[userId]
    return isUsableDisplayName(n) ? n : undefined
  }

  function getNameByEmail(email?: string | null): string | undefined {
    if (!email) return undefined
    const n = byEmail.value[email.trim().toLowerCase()]
    return isUsableDisplayName(n) ? n : undefined
  }

  function getUserIdByEmail(email?: string | null): string | undefined {
    if (!email) return undefined
    return userIdByEmail.value[email.trim().toLowerCase()]
  }

  /**
   * 任意キー（userId / email / 表示名）から表示名を解決
   * タスク assigneeName がメールでもメンバー表から人名に変換する
   */
  function resolveKey(
    userId?: string | null,
    fallbackName?: string | null,
    email?: string | null,
  ): string | undefined {
    if (userId) {
      const n = getName(userId)
      if (n) return n
    }
    const mail = email || (isEmailLike(fallbackName) ? fallbackName : null)
    if (mail) {
      const n = getNameByEmail(mail)
      if (n) return n
      // email から userId が分かれば再解決
      const id = getUserIdByEmail(mail)
      if (id) {
        const n2 = getName(id)
        if (n2) return n2
      }
    }
    if (isUsableDisplayName(fallbackName)) {
      return fallbackName!.trim()
    }
    return undefined
  }

  function ingestMember(member: ProjectMember): void {
    const name = isUsableDisplayName(member.displayName)
      ? member.displayName.trim()
      : undefined
    if (member.userId && name) {
      setName(member.userId, name)
    }
    if (member.email && name) {
      setEmailName(member.email, name, member.userId)
    }
    // displayName がメールだけ入っている古いデータは無視
  }

  function ingestProject(project: Project | null | undefined): void {
    if (!project) return
    for (const m of project.members ?? []) {
      ingestMember(m)
    }
    // メンバー取り込み後、タスクのメール assigneeName を人名に直す
    void applyToEntityStores()
  }

  function ingestProjects(projects: Project[]): void {
    for (const p of projects) {
      for (const m of p.members ?? []) {
        ingestMember(m)
      }
    }
    void applyToEntityStores()
  }

  function ingestTasks(tasks: Task[]): void {
    for (const t of tasks) {
      // メールが入っている assigneeName はディレクトリを汚染しない
      if (t.assigneeId && isUsableDisplayName(t.assigneeName)) {
        setName(t.assigneeId, t.assigneeName)
      }
      // メールだけなら email→userId の逆引き用に残さない（メンバー側で解決）
    }
  }

  function ingestComments(comments: Comment[]): void {
    for (const c of comments) {
      if (c.authorId && isUsableDisplayName(c.authorName)) {
        setName(c.authorId, c.authorName)
      }
    }
  }

  /**
   * 指定 userId の最新表示名をクラウドから一括取得してマップを更新
   */
  async function refreshUserIds(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))]
    if (unique.length === 0) return
    try {
      const names = await usersApi.fetchDisplayNames(unique)
      let changed = false
      const next = { ...byUserId.value }
      for (const [id, name] of Object.entries(names)) {
        if (!id || !isUsableDisplayName(name)) continue
        const n = name.trim()
        if (next[id] !== n) {
          next[id] = n
          changed = true
        }
      }
      if (changed) {
        byUserId.value = next
        await applyToEntityStores()
      }
    } catch (e) {
      // 未デプロイの API でもメンバー snapshot で表示できるよう警告のみ
      console.warn('表示名の一括取得に失敗（メンバー表示名で継続）:', e)
    }
  }

  async function refreshKnownUsers(): Promise<void> {
    const ids = new Set<string>(Object.keys(byUserId.value))
    try {
      const { useProjectsStore } = await import('./projects')
      const { useTasksStore } = await import('./tasks')
      const { useCommentsStore } = await import('./comments')
      const projectsStore = useProjectsStore()
      const tasksStore = useTasksStore()
      const commentsStore = useCommentsStore()

      for (const p of projectsStore.projects) {
        for (const m of p.members ?? []) {
          if (m.userId) ids.add(m.userId)
          ingestMember(m)
        }
        for (const id of p.memberIds ?? []) ids.add(id)
        if (p.createdBy) ids.add(p.createdBy)
      }
      if (projectsStore.currentProject) {
        const p = projectsStore.currentProject
        for (const m of p.members ?? []) {
          if (m.userId) ids.add(m.userId)
          ingestMember(m)
        }
        for (const id of p.memberIds ?? []) ids.add(id)
        if (p.createdBy) ids.add(p.createdBy)
      }
      for (const t of tasksStore.tasks) {
        if (t.assigneeId) ids.add(t.assigneeId)
      }
      if (tasksStore.currentTask?.assigneeId) {
        ids.add(tasksStore.currentTask.assigneeId)
      }
      for (const c of commentsStore.comments) {
        if (c.authorId) ids.add(c.authorId)
      }
    } catch {
      // stores 未初期化
    }
    await refreshUserIds([...ids])
    await applyToEntityStores()
  }

  /**
   * マップの最新名を projects / tasks / comments に反映
   * 特にタスク: assigneeName がメールでもメンバー表から人名に直す
   */
  async function applyToEntityStores(): Promise<void> {
    const idMap = byUserId.value
    const emailMap = byEmail.value
    const emailToId = userIdByEmail.value
    try {
      const { useProjectsStore } = await import('./projects')
      const { useTasksStore } = await import('./tasks')
      const { useCommentsStore } = await import('./comments')
      const projectsStore = useProjectsStore()
      const tasksStore = useTasksStore()
      const commentsStore = useCommentsStore()

      const patchMembers = (members: ProjectMember[] | undefined): ProjectMember[] | undefined => {
        if (!members) return members
        return members.map((m): ProjectMember => {
          const mapped = m.userId ? idMap[m.userId] : undefined
          if (mapped && isUsableDisplayName(mapped)) {
            return { ...m, displayName: mapped }
          }
          return m
        })
      }

      projectsStore.projects = projectsStore.projects.map((p) => ({
        ...p,
        members: patchMembers(p.members),
      }))
      if (projectsStore.currentProject) {
        projectsStore.currentProject = {
          ...projectsStore.currentProject,
          members: patchMembers(projectsStore.currentProject.members),
        }
      }

      const resolveTaskAssignee = (t: Task): Task => {
        // 1) userId から
        if (t.assigneeId) {
          const mapped = idMap[t.assigneeId]
          if (mapped && isUsableDisplayName(mapped)) {
            if (t.assigneeName === mapped) return t
            return { ...t, assigneeName: mapped }
          }
        }
        // 2) assigneeName がメール → メンバー表
        const nameOrEmail = t.assigneeName?.trim()
        if (nameOrEmail && isEmailLike(nameOrEmail)) {
          const em = nameOrEmail.toLowerCase()
          const display = emailMap[em]
          const uid = t.assigneeId || emailToId[em]
          if (display && isUsableDisplayName(display)) {
            return {
              ...t,
              assigneeId: uid || t.assigneeId,
              assigneeName: display,
            }
          }
          if (uid) {
            const mapped = idMap[uid]
            if (mapped && isUsableDisplayName(mapped)) {
              return {
                ...t,
                assigneeId: uid,
                assigneeName: mapped,
              }
            }
          }
        }
        return t
      }

      tasksStore.tasks = tasksStore.tasks.map(resolveTaskAssignee)
      if (tasksStore.currentTask) {
        tasksStore.currentTask = resolveTaskAssignee(tasksStore.currentTask)
      }

      commentsStore.comments = commentsStore.comments.map((c) => {
        const mapped = idMap[c.authorId]
        if (mapped && isUsableDisplayName(mapped)) {
          return { ...c, authorName: mapped }
        }
        return c
      })
    } catch (e) {
      console.warn('表示名のストア反映に失敗:', e)
    }
  }

  function clear(): void {
    byUserId.value = {}
    byEmail.value = {}
    userIdByEmail.value = {}
  }

  return {
    byUserId,
    byEmail,
    userIdByEmail,
    setName,
    setEmailName,
    getName,
    getNameByEmail,
    getUserIdByEmail,
    resolveKey,
    ingestMember,
    ingestProject,
    ingestProjects,
    ingestTasks,
    ingestComments,
    refreshUserIds,
    refreshKnownUsers,
    applyToEntityStores,
    clear,
  }
})
