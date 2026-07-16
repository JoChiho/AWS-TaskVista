// プロジェクト管理ストア（詳細は SWR キャッシュ）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  Project,
  CreateProjectPayload,
  UpdateProjectPayload,
  AddProjectMemberPayload,
} from '@/types/project'
import * as projectsApi from '@/api/projects'
import { useUiStore } from './ui'
import { useAuthStore } from './auth'
import { useDisplayNamesStore } from './displayNames'

const FRESH_MS = 30_000

function projectFingerprint(p: Project): string {
  const members = (p.members ?? [])
    .map((m) => `${m.userId ?? ''}:${m.email}:${m.displayName}`)
    .sort()
    .join(',')
  return [
    p.projectId,
    p.updatedAt,
    p.name,
    p.status,
    (p.memberIds ?? []).slice().sort().join(','),
    members,
  ].join('|')
}

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([])
  const currentProject = ref<Project | null>(null)
  const isLoading = ref(false)
  const isRefreshing = ref(false)
  const detailFetchedAt = ref(0)
  const detailCache = new Map<string, { project: Project; fetchedAt: number }>()

  const uiStore = useUiStore()

  const hasCurrentProject = computed(
    () => !!currentProject.value?.projectId && detailFetchedAt.value > 0,
  )

  /**
   * プロジェクト一覧を取得する
   */
  async function fetchProjects(): Promise<void> {
    isLoading.value = true
    try {
      projects.value = await projectsApi.fetchProjects()
      const displayNames = useDisplayNamesStore()
      displayNames.ingestProjects(projects.value)
      const ids = projects.value.flatMap((p) => [
        ...(p.memberIds ?? []),
        ...(p.members ?? []).map((m) => m.userId).filter(Boolean) as string[],
        p.createdBy,
      ])
      await displayNames.refreshUserIds(ids)
    } catch (error: unknown) {
      uiStore.showError('プロジェクトの読み込みに失敗しました')
      console.error('プロジェクト一覧取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  async function applyProject(project: Project): Promise<void> {
    currentProject.value = project
    detailFetchedAt.value = Date.now()
    detailCache.set(project.projectId, {
      project: { ...project, members: project.members ? [...project.members] : [] },
      fetchedAt: detailFetchedAt.value,
    })
    const displayNames = useDisplayNamesStore()
    displayNames.ingestProject(project)
    const ids = [
      ...(project.memberIds ?? []),
      ...(project.members ?? []).map((m) => m.userId).filter(Boolean) as string[],
      project.createdBy,
    ]
    await displayNames.refreshUserIds(ids)
    const idx = projects.value.findIndex((p) => p.projectId === project.projectId)
    if (idx !== -1) {
      projects.value[idx] = project
    }
  }

  async function loadProjectFromApi(projectId: string): Promise<void> {
    const project = await projectsApi.fetchProject(projectId)
    const prev = currentProject.value?.projectId === projectId ? currentProject.value : null
    if (!prev || projectFingerprint(prev) !== projectFingerprint(project)) {
      await applyProject(project)
    } else {
      detailFetchedAt.value = Date.now()
      detailCache.set(projectId, { project: prev, fetchedAt: detailFetchedAt.value })
    }
  }

  /**
   * プロジェクト詳細を用意する（SWR）
   * キャッシュがあれば即表示し、古ければ裏で再取得
   */
  async function ensureProject(
    projectId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const force = options?.force ?? false
    const cached = detailCache.get(projectId)

    if (currentProject.value?.projectId !== projectId) {
      if (cached) {
        currentProject.value = cached.project
        detailFetchedAt.value = cached.fetchedAt
        useDisplayNamesStore().ingestProject(cached.project)
      } else {
        // 一覧にあれば暫定表示
        const fromList = projects.value.find((p) => p.projectId === projectId)
        if (fromList) {
          currentProject.value = fromList
          detailFetchedAt.value = 0
        }
      }
    }

    const hasCache =
      currentProject.value?.projectId === projectId &&
      (detailFetchedAt.value > 0 || !!cached)
    const isFresh =
      !force &&
      currentProject.value?.projectId === projectId &&
      detailFetchedAt.value > 0 &&
      Date.now() - detailFetchedAt.value < FRESH_MS

    if (hasCache) {
      if (isFresh) return
      if (isRefreshing.value) return
      isRefreshing.value = true
      try {
        await loadProjectFromApi(projectId)
      } catch (error: unknown) {
        console.error('プロジェクトのバックグラウンド更新に失敗:', error)
      } finally {
        isRefreshing.value = false
      }
      return
    }

    isLoading.value = true
    try {
      await loadProjectFromApi(projectId)
    } catch (error: unknown) {
      uiStore.showError('プロジェクトの取得に失敗しました')
      console.error('プロジェクト詳細取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /** @deprecated ensureProject を推奨 */
  async function fetchProject(projectId: string): Promise<void> {
    await ensureProject(projectId, { force: true })
  }

  /**
   * 新しいプロジェクトを作成する
   * @param payload プロジェクト作成データ
   */
  async function createProject(payload: CreateProjectPayload): Promise<Project> {
    isLoading.value = true
    try {
      const authStore = useAuthStore()
      const newProject = await projectsApi.createProject({
        ...payload,
        creatorDisplayName: payload.creatorDisplayName || authStore.displayLabel,
      })
      // 一覧の先頭に追加する
      projects.value.unshift(newProject)
      useDisplayNamesStore().ingestProject(newProject)
      uiStore.showSuccess('プロジェクトを作成しました')
      return newProject
    } catch (error: any) {
      uiStore.showError('プロジェクトの作成に失敗しました')
      console.error('プロジェクト作成エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * プロジェクトメンバーを追加する
   */
  async function addMember(
    projectId: string,
    payload: AddProjectMemberPayload,
  ): Promise<Project> {
    isLoading.value = true
    try {
      const updated = await projectsApi.addProjectMember(projectId, payload)
      syncProject(updated)
      uiStore.showSuccess('メンバーを追加しました')
      return updated
    } catch (error: any) {
      uiStore.showError('メンバーの追加に失敗しました')
      console.error('メンバー追加エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * プロジェクトメンバーを削除する
   */
  async function removeMember(projectId: string, memberKey: string): Promise<Project> {
    isLoading.value = true
    try {
      const updated = await projectsApi.removeProjectMember(projectId, memberKey)
      syncProject(updated)
      uiStore.showSuccess('メンバーを削除しました')
      return updated
    } catch (error: any) {
      uiStore.showError('メンバーの削除に失敗しました')
      console.error('メンバー削除エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  function syncProject(updated: Project): void {
    const index = projects.value.findIndex((p) => p.projectId === updated.projectId)
    if (index !== -1) {
      projects.value[index] = updated
    }
    if (currentProject.value?.projectId === updated.projectId) {
      currentProject.value = updated
    }
    useDisplayNamesStore().ingestProject(updated)
  }

  /**
   * プロジェクト情報を更新する
   * @param projectId プロジェクト ID
   * @param payload 更新データ
   */
  async function updateProject(
    projectId: string,
    payload: UpdateProjectPayload,
  ): Promise<Project> {
    isLoading.value = true
    try {
      const updatedProject = await projectsApi.updateProject(projectId, payload)
      syncProject(updatedProject)
      uiStore.showSuccess('プロジェクトを更新しました')
      return updatedProject
    } catch (error: any) {
      uiStore.showError('プロジェクトの更新に失敗しました')
      console.error('プロジェクト更新エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * プロジェクトを論理削除する
   * @param projectId プロジェクト ID
   */
  async function deleteProject(projectId: string): Promise<void> {
    isLoading.value = true
    try {
      await projectsApi.deleteProject(projectId)

      // 一覧から削除する
      projects.value = projects.value.filter((p) => p.projectId !== projectId)

      // 現在選択中のプロジェクトをクリアする
      if (currentProject.value?.projectId === projectId) {
        currentProject.value = null
      }

      uiStore.showSuccess('プロジェクトを削除しました')
    } catch (error: any) {
      uiStore.showError('プロジェクトの削除に失敗しました')
      console.error('プロジェクト削除エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  return {
    projects,
    currentProject,
    isLoading,
    isRefreshing,
    hasCurrentProject,
    fetchProjects,
    fetchProject,
    ensureProject,
    createProject,
    updateProject,
    addMember,
    removeMember,
    deleteProject,
  }
})
