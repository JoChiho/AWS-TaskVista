// タスク管理ストア
// かんばんの楽観的更新・ロールバック + プロジェクト単位キャッシュ（SWR）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { enrichWithWbs } from '@/utils/wbs'
import type {
  Task,
  TaskStatus,
  TasksByStatus,
  CreateTaskPayload,
  UpdateTaskPayload,
} from '@/types/task'
import { TASK_STATUSES } from '@/types/task'
import * as tasksApi from '@/api/tasks'
import { useUiStore } from './ui'
import { useDisplayNamesStore } from './displayNames'

/** キャッシュが「新鮮」とみなす時間（この間は再取得しない） */
const FRESH_MS = 30_000

interface ProjectTasksCache {
  tasks: Task[]
  fetchedAt: number
  fingerprint: string
}

/** 一覧の差分判定用フィンガープリント */
export function tasksFingerprint(list: Task[]): string {
  return list
    .map(
      (t) =>
        [
          t.taskId,
          t.updatedAt,
          t.status,
          t.title,
          t.requirement ?? '',
          t.assigneeId ?? '',
          t.assigneeName ?? '',
          t.priority,
          t.plannedStartDate ?? t.startDate ?? '',
          t.plannedDueDate ?? t.dueDate ?? '',
          t.actualStartDate ?? '',
          t.actualDueDate ?? '',
          t.estimatedEffortDays ?? '',
          t.actualEffortDays ?? '',
          t.completionPercent ?? '',
          t.parentTaskId ?? '',
          t.wbsCode ?? '',
          t.sortOrder ?? '',
          t.childCount ?? '',
          t.isDeleted ? '1' : '0',
        ].join(':'),
    )
    .sort()
    .join('|')
}

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const currentTask = ref<Task | null>(null)
  /** 初回ロード（キャッシュ無し）時のみ true → スケルトン表示用 */
  const isLoading = ref(false)
  /** バックグラウンド再取得中（UI は既存データを出したまま） */
  const isRefreshing = ref(false)
  const currentProjectId = ref<string | null>(null)
  const lastFetchedAt = ref(0)

  /** プロジェクトごとのメモリキャッシュ */
  const cacheByProject = new Map<string, ProjectTasksCache>()

  const uiStore = useUiStore()

  const tasksByStatus = computed<TasksByStatus>(() => {
    const grouped: TasksByStatus = {} as TasksByStatus
    for (const status of TASK_STATUSES) {
      grouped[status] = []
    }
    for (const task of tasks.value) {
      if (!task.isDeleted && grouped[task.status]) {
        grouped[task.status].push(task)
      }
    }
    return grouped
  })

  const activeTasks = computed<Task[]>(() => tasks.value.filter((t) => !t.isDeleted))

  /** 表示用キャッシュがあるか（スケルトンを出さない判定） */
  const hasDataForCurrentProject = computed(() => {
    if (!currentProjectId.value) return false
    if (lastFetchedAt.value > 0) return true
    return cacheByProject.has(currentProjectId.value)
  })

  /** 親子の childCount / rollup をクライアントで即時再計算 */
  function recomputeWbs(): void {
    tasks.value = enrichWithWbs(tasks.value)
    if (currentTask.value) {
      const refreshed = tasks.value.find((t) => t.taskId === currentTask.value?.taskId)
      if (refreshed) currentTask.value = refreshed
    }
  }

  function setTasks(list: Task[]): void {
    tasks.value = enrichWithWbs(list)
  }

  function saveCache(projectId: string): void {
    cacheByProject.set(projectId, {
      tasks: tasks.value.map((t) => ({ ...t })),
      fetchedAt: lastFetchedAt.value,
      fingerprint: tasksFingerprint(tasks.value),
    })
  }

  function restoreCache(projectId: string): boolean {
    const cached = cacheByProject.get(projectId)
    if (!cached) return false
    setTasks(cached.tasks.map((t) => ({ ...t })))
    currentProjectId.value = projectId
    lastFetchedAt.value = cached.fetchedAt
    return true
  }

  async function applyDisplayNames(list: Task[]): Promise<void> {
    const displayNames = useDisplayNamesStore()
    displayNames.ingestTasks(list)
    const ids = list.map((t) => t.assigneeId).filter(Boolean) as string[]
    if (ids.length > 0) {
      await displayNames.refreshUserIds(ids)
    }
    await displayNames.applyToEntityStores()
  }

  /**
   * API から取得し、変化があるときだけ tasks を差し替える
   */
  async function loadFromApi(projectId: string): Promise<void> {
    const data = await tasksApi.fetchTasks(projectId)
    const nextFp = tasksFingerprint(data)
    const prevFp =
      currentProjectId.value === projectId
        ? tasksFingerprint(tasks.value)
        : cacheByProject.get(projectId)?.fingerprint

    currentProjectId.value = projectId
    lastFetchedAt.value = Date.now()

    if (prevFp !== nextFp) {
      setTasks(data)
      await applyDisplayNames(tasks.value)
    } else {
      // 指紋が同じでも rollup を最新化
      recomputeWbs()
    }

    saveCache(projectId)
  }

  /**
   * プロジェクトのタスクを用意する（SWR）
   * - キャッシュあり → 即表示、必要なら裏で再取得
   * - キャッシュなし → スケルトン付きで取得
   * - force: true → 必ず再取得（手動更新など）
   */
  async function ensureTasks(
    projectId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const force = options?.force ?? false

    // 別プロジェクトへ切り替え: 現在分を保存し、先にキャッシュを出す
    if (currentProjectId.value && currentProjectId.value !== projectId) {
      saveCache(currentProjectId.value)
      const restored = restoreCache(projectId)
      if (!restored) {
        tasks.value = []
        currentProjectId.value = projectId
        lastFetchedAt.value = 0
      }
    } else if (!currentProjectId.value) {
      restoreCache(projectId)
      currentProjectId.value = projectId
    }

    const hasCache =
      currentProjectId.value === projectId &&
      (lastFetchedAt.value > 0 || cacheByProject.has(projectId))

    const isFresh =
      !force &&
      currentProjectId.value === projectId &&
      lastFetchedAt.value > 0 &&
      Date.now() - lastFetchedAt.value < FRESH_MS

    if (hasCache) {
      if (isFresh) return
      // 裏で再取得（スケルトンなし）
      if (isRefreshing.value) return
      isRefreshing.value = true
      try {
        await loadFromApi(projectId)
      } catch (error: unknown) {
        console.error('タスクのバックグラウンド更新に失敗:', error)
        // キャッシュ表示は維持。エラーは静かに（初回ロード失敗時のみトースト）
      } finally {
        isRefreshing.value = false
      }
      return
    }

    // 初回: スケルトン表示
    isLoading.value = true
    currentProjectId.value = projectId
    try {
      await loadFromApi(projectId)
    } catch (error: unknown) {
      uiStore.showError('タスクの読み込みに失敗しました')
      console.error('タスク一覧取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /** @deprecated ensureTasks を推奨。互換のため残す */
  async function fetchTasks(projectId: string): Promise<void> {
    await ensureTasks(projectId, { force: true })
  }

  async function fetchTask(taskId: string): Promise<void> {
    try {
      currentTask.value = await tasksApi.fetchTask(taskId)
      if (currentTask.value) {
        const displayNames = useDisplayNamesStore()
        displayNames.ingestTasks([currentTask.value])
        if (currentTask.value.assigneeId) {
          await displayNames.refreshUserIds([currentTask.value.assigneeId])
        }
        _replaceTaskInList(currentTask.value)
      }
    } catch (error: unknown) {
      uiStore.showError('タスクの取得に失敗しました')
      console.error('タスク詳細取得エラー:', error)
      throw error
    }
  }

  async function createTask(projectId: string, payload: CreateTaskPayload): Promise<Task> {
    try {
      const newTask = await tasksApi.createTask(projectId, payload)
      if (currentProjectId.value === projectId) {
        tasks.value = [...tasks.value, newTask]
        recomputeWbs()
        lastFetchedAt.value = Date.now()
        saveCache(projectId)
      }
      useDisplayNamesStore().ingestTasks([newTask])
      uiStore.showSuccess('タスクを作成しました')
      return newTask
    } catch (error: unknown) {
      uiStore.showError('タスクの作成に失敗しました')
      console.error('タスク作成エラー:', error)
      throw error
    }
  }

  async function updateTask(taskId: string, payload: UpdateTaskPayload): Promise<Task> {
    try {
      const updatedTask = await tasksApi.updateTask(taskId, payload)
      _replaceTaskInList(updatedTask)
      if (currentProjectId.value) {
        lastFetchedAt.value = Date.now()
        saveCache(currentProjectId.value)
      }
      uiStore.showSuccess('タスクを更新しました')
      return updatedTask
    } catch (error: unknown) {
      uiStore.showError('タスクの更新に失敗しました')
      console.error('タスク更新エラー:', error)
      throw error
    }
  }

  async function updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
    const originalTask = tasks.value.find((t) => t.taskId === taskId)
    if (!originalTask) return

    const previousStatus = originalTask.status
    _updateTaskStatusInList(taskId, newStatus)

    try {
      const updatedTask = await tasksApi.updateTaskStatus(taskId, { status: newStatus })
      _replaceTaskInList(updatedTask)
      if (currentProjectId.value) {
        lastFetchedAt.value = Date.now()
        saveCache(currentProjectId.value)
      }
    } catch (error: unknown) {
      _updateTaskStatusInList(taskId, previousStatus)
      recomputeWbs()
      uiStore.showError('ステータスの更新に失敗しました。元に戻します')
      console.error('タスクステータス更新エラー:', error)
    }
  }

  async function deleteTask(taskId: string): Promise<void> {
    try {
      await tasksApi.deleteTask(taskId)
      // カスケード削除: 子孫も一覧から落とす
      const removeIds = new Set<string>([taskId])
      let changed = true
      while (changed) {
        changed = false
        for (const t of tasks.value) {
          if (t.parentTaskId && removeIds.has(t.parentTaskId) && !removeIds.has(t.taskId)) {
            removeIds.add(t.taskId)
            changed = true
          }
        }
      }
      tasks.value = tasks.value.filter((t) => !removeIds.has(t.taskId))
      recomputeWbs()
      if (currentTask.value && removeIds.has(currentTask.value.taskId)) {
        currentTask.value = null
      }
      if (currentProjectId.value) {
        lastFetchedAt.value = Date.now()
        saveCache(currentProjectId.value)
      }
      uiStore.showSuccess('タスクを削除しました')
    } catch (error: unknown) {
      uiStore.showError('タスクの削除に失敗しました')
      console.error('タスク削除エラー:', error)
      throw error
    }
  }

  function _replaceTaskInList(updatedTask: Task): void {
    const index = tasks.value.findIndex((t) => t.taskId === updatedTask.taskId)
    if (index !== -1) {
      const next = [...tasks.value]
      next[index] = updatedTask
      tasks.value = next
    } else {
      tasks.value = [...tasks.value, updatedTask]
    }
    recomputeWbs()
    useDisplayNamesStore().ingestTasks([updatedTask])
  }

  function _updateTaskStatusInList(taskId: string, status: TaskStatus): void {
    const index = tasks.value.findIndex((t) => t.taskId === taskId)
    if (index === -1) return
    const next = [...tasks.value]
    next[index] = {
      ...next[index]!,
      status,
      updatedAt: new Date().toISOString(),
    }
    tasks.value = next
    recomputeWbs()
  }

  /** キャッシュを無効化（他画面から強制更新したいとき） */
  function invalidate(projectId?: string): void {
    if (projectId) {
      cacheByProject.delete(projectId)
      if (currentProjectId.value === projectId) {
        lastFetchedAt.value = 0
      }
    } else {
      cacheByProject.clear()
      lastFetchedAt.value = 0
    }
  }

  return {
    tasks,
    currentTask,
    isLoading,
    isRefreshing,
    currentProjectId,
    lastFetchedAt,
    tasksByStatus,
    activeTasks,
    hasDataForCurrentProject,
    ensureTasks,
    fetchTasks,
    fetchTask,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
    invalidate,
  }
})
