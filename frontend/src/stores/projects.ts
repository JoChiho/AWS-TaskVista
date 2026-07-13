// プロジェクト管理ストア
import { defineStore } from 'pinia'
import { ref } from 'vue'
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

export const useProjectsStore = defineStore('projects', () => {
  // プロジェクト一覧
  const projects = ref<Project[]>([])
  // 現在選択中のプロジェクト
  const currentProject = ref<Project | null>(null)
  // ローディング状態
  const isLoading = ref(false)

  const uiStore = useUiStore()

  /**
   * プロジェクト一覧を取得する
   */
  async function fetchProjects(): Promise<void> {
    isLoading.value = true
    try {
      projects.value = await projectsApi.fetchProjects()
      const displayNames = useDisplayNamesStore()
      displayNames.ingestProjects(projects.value)
      // メンバーのクラウド最新表示名を一括で揃える（他ユーザー含む）
      const ids = projects.value.flatMap((p) => [
        ...(p.memberIds ?? []),
        ...(p.members ?? []).map((m) => m.userId).filter(Boolean) as string[],
        p.createdBy,
      ])
      await displayNames.refreshUserIds(ids)
    } catch (error: any) {
      uiStore.showError('プロジェクトの読み込みに失敗しました')
      console.error('プロジェクト一覧取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * プロジェクト詳細を取得する
   * @param projectId プロジェクト ID
   */
  async function fetchProject(projectId: string): Promise<void> {
    isLoading.value = true
    try {
      currentProject.value = await projectsApi.fetchProject(projectId)
      const displayNames = useDisplayNamesStore()
      displayNames.ingestProject(currentProject.value)
      if (currentProject.value) {
        const p = currentProject.value
        const ids = [
          ...(p.memberIds ?? []),
          ...(p.members ?? []).map((m) => m.userId).filter(Boolean) as string[],
          p.createdBy,
        ]
        await displayNames.refreshUserIds(ids)
      }
      // 一覧側も同期
      if (currentProject.value) {
        const idx = projects.value.findIndex(
          (p) => p.projectId === currentProject.value!.projectId,
        )
        if (idx !== -1) {
          projects.value[idx] = currentProject.value
        }
      }
    } catch (error: any) {
      uiStore.showError('プロジェクトの取得に失敗しました')
      console.error('プロジェクト詳細取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
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
    fetchProjects,
    fetchProject,
    createProject,
    updateProject,
    addMember,
    removeMember,
    deleteProject,
  }
})
