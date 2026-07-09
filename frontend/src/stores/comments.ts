// コメント管理ストア
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Comment, CreateCommentPayload } from '@/types/comment'
import * as commentsApi from '@/api/comments'
import { useUiStore } from './ui'
import { useAuthStore } from './auth'

export const useCommentsStore = defineStore('comments', () => {
  // 現在のタスクのコメント一覧
  const comments = ref<Comment[]>([])
  // 現在読み込み中 / 表示中のタスク ID（取り違え防止）
  const activeTaskId = ref<string | null>(null)
  // ローディング状態
  const isLoading = ref(false)
  // コメント送信中の状態
  const isSubmitting = ref(false)
  // 古い非同期レスポンスを破棄するための世代番号
  let fetchGeneration = 0

  const uiStore = useUiStore()

  /**
   * タスクのコメント一覧を取得する
   * タスク切り替え時のレースコンディションを防ぐ
   */
  async function fetchComments(taskId: string): Promise<void> {
    const generation = ++fetchGeneration
    activeTaskId.value = taskId
    isLoading.value = true
    comments.value = []

    try {
      const data = await commentsApi.fetchComments(taskId)
      // 別タスクの取得が後から返ってきた場合は破棄する
      if (generation !== fetchGeneration || activeTaskId.value !== taskId) {
        return
      }
      // サーバー側の taskId と一致するコメントのみ表示する
      comments.value = data.filter((c) => c.taskId === taskId)
    } catch (error: unknown) {
      if (generation === fetchGeneration && activeTaskId.value === taskId) {
        uiStore.showError('コメントの読み込みに失敗しました')
        console.error('コメント一覧取得エラー:', error)
      }
    } finally {
      if (generation === fetchGeneration) {
        isLoading.value = false
      }
    }
  }

  /**
   * コメントを投稿する
   */
  async function createComment(taskId: string, payload: CreateCommentPayload): Promise<void> {
    if (activeTaskId.value && activeTaskId.value !== taskId) {
      // 表示中タスクと不一致の場合は投稿しない
      uiStore.showError('タスクが切り替わったため、コメントを送信できませんでした')
      return
    }

    isSubmitting.value = true
    try {
      const authStore = useAuthStore()
      const newComment = await commentsApi.createComment(taskId, {
        ...payload,
        authorDisplayName: payload.authorDisplayName || authStore.displayLabel,
      })

      // 投稿完了時点でも同じタスクを見ている場合のみ追加する
      if (activeTaskId.value === taskId && newComment.taskId === taskId) {
        comments.value.push(newComment)
      }
    } catch (error: unknown) {
      uiStore.showError('コメントの投稿に失敗しました')
      console.error('コメント作成エラー:', error)
      throw error
    } finally {
      isSubmitting.value = false
    }
  }

  /**
   * コメントを削除する（作成者のみ実行可能）
   */
  async function deleteComment(taskId: string, commentId: string): Promise<void> {
    try {
      await commentsApi.deleteComment(taskId, commentId)
      if (activeTaskId.value === taskId) {
        comments.value = comments.value.filter((c) => c.commentId !== commentId)
      }
    } catch (error: unknown) {
      uiStore.showError('コメントの削除に失敗しました')
      console.error('コメント削除エラー:', error)
      throw error
    }
  }

  /** コメント一覧をクリアする（タスク切り替え時） */
  function clearComments(): void {
    fetchGeneration += 1
    activeTaskId.value = null
    comments.value = []
    isLoading.value = false
  }

  return {
    comments,
    activeTaskId,
    isLoading,
    isSubmitting,
    fetchComments,
    createComment,
    deleteComment,
    clearComments,
  }
})
