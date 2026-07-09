// タスク管理ストア
// かんばんの楽観的更新・ロールバックロジックを含む
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
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

export const useTasksStore = defineStore('tasks', () => {
  // 現在のプロジェクトのタスク一覧
  const tasks = ref<Task[]>([])
  // 現在選択中のタスク
  const currentTask = ref<Task | null>(null)
  // ローディング状態
  const isLoading = ref(false)
  // 現在表示中のプロジェクト ID
  const currentProjectId = ref<string | null>(null)

  const uiStore = useUiStore()

  /**
   * タスクをステータス別にグループ化した計算プロパティ
   * かんばんビューで使用する
   */
  const tasksByStatus = computed<TasksByStatus>(() => {
    const grouped: TasksByStatus = {} as TasksByStatus
    // 全ステータスの空配列を初期化する
    for (const status of TASK_STATUSES) {
      grouped[status] = []
    }
    // 削除済みを除外してグループ化する
    for (const task of tasks.value) {
      if (!task.isDeleted && grouped[task.status]) {
        grouped[task.status].push(task)
      }
    }
    return grouped
  })

  /**
   * アクティブなタスク（削除済みを除く）の計算プロパティ
   * テーブルビューで使用する
   */
  const activeTasks = computed<Task[]>(() => tasks.value.filter((t) => !t.isDeleted))

  /**
   * プロジェクト内のタスク一覧を取得する
   * @param projectId プロジェクト ID
   */
  async function fetchTasks(projectId: string): Promise<void> {
    isLoading.value = true
    currentProjectId.value = projectId
    try {
      tasks.value = await tasksApi.fetchTasks(projectId)
    } catch (error: any) {
      uiStore.showError('タスクの読み込みに失敗しました')
      console.error('タスク一覧取得エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * タスク詳細を取得する
   * @param taskId タスク ID
   */
  async function fetchTask(taskId: string): Promise<void> {
    try {
      currentTask.value = await tasksApi.fetchTask(taskId)
    } catch (error: any) {
      uiStore.showError('タスクの取得に失敗しました')
      console.error('タスク詳細取得エラー:', error)
      throw error
    }
  }

  /**
   * 新しいタスクを作成する
   * @param projectId プロジェクト ID
   * @param payload タスク作成データ
   */
  async function createTask(projectId: string, payload: CreateTaskPayload): Promise<Task> {
    isLoading.value = true
    try {
      const newTask = await tasksApi.createTask(projectId, payload)
      tasks.value.push(newTask)
      uiStore.showSuccess('タスクを作成しました')
      return newTask
    } catch (error: any) {
      uiStore.showError('タスクの作成に失敗しました')
      console.error('タスク作成エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * タスク情報を更新する
   * @param taskId タスク ID
   * @param payload 更新データ
   */
  async function updateTask(taskId: string, payload: UpdateTaskPayload): Promise<Task> {
    isLoading.value = true
    try {
      const updatedTask = await tasksApi.updateTask(taskId, payload)
      _replaceTaskInList(updatedTask)
      uiStore.showSuccess('タスクを更新しました')
      return updatedTask
    } catch (error: any) {
      uiStore.showError('タスクの更新に失敗しました')
      console.error('タスク更新エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * タスクのステータスを更新する（かんばんドラッグ専用）
   * 楽観的更新を実装し、API 失敗時は元のステータスにロールバックする
   * @param taskId タスク ID
   * @param newStatus 新しいステータス
   */
  async function updateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
    // 元のタスクを記憶しておく（ロールバック用）
    const originalTask = tasks.value.find((t) => t.taskId === taskId)
    if (!originalTask) return

    const previousStatus = originalTask.status

    // 楽観的更新：API レスポンスを待たずに UI を即座に更新する
    _updateTaskStatusInList(taskId, newStatus)

    try {
      const updatedTask = await tasksApi.updateTaskStatus(taskId, { status: newStatus })
      // サーバーの最新データで同期する（updatedAt を反映）
      _replaceTaskInList(updatedTask)
    } catch (error: any) {
      // API 失敗時：元のステータスにロールバックする
      _updateTaskStatusInList(taskId, previousStatus)
      uiStore.showError('ステータスの更新に失敗しました。元に戻します')
      console.error('タスクステータス更新エラー:', error)
    }
  }

  /**
   * タスクを論理削除する
   * @param taskId タスク ID
   */
  async function deleteTask(taskId: string): Promise<void> {
    isLoading.value = true
    try {
      await tasksApi.deleteTask(taskId)
      // 一覧から削除する
      tasks.value = tasks.value.filter((t) => t.taskId !== taskId)

      // 現在選択中のタスクをクリアする
      if (currentTask.value?.taskId === taskId) {
        currentTask.value = null
      }

      uiStore.showSuccess('タスクを削除しました')
    } catch (error: any) {
      uiStore.showError('タスクの削除に失敗しました')
      console.error('タスク削除エラー:', error)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  /**
   * タスク一覧内の特定タスクを置き換える内部ヘルパー
   */
  function _replaceTaskInList(updatedTask: Task): void {
    const index = tasks.value.findIndex((t) => t.taskId === updatedTask.taskId)
    if (index !== -1) {
      tasks.value[index] = updatedTask
    }
    if (currentTask.value?.taskId === updatedTask.taskId) {
      currentTask.value = updatedTask
    }
  }

  /**
   * タスク一覧内の特定タスクのステータスを更新する内部ヘルパー
   */
  function _updateTaskStatusInList(taskId: string, status: TaskStatus): void {
    const task = tasks.value.find((t) => t.taskId === taskId)
    if (task) {
      task.status = status
    }
  }

  return {
    tasks,
    currentTask,
    isLoading,
    currentProjectId,
    tasksByStatus,
    activeTasks,
    fetchTasks,
    fetchTask,
    createTask,
    updateTask,
    updateTaskStatus,
    deleteTask,
  }
})
