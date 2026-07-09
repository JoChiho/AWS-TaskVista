// コメント管理ストア
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Comment, CreateCommentPayload } from '@/types/comment'
import * as commentsApi from '@/api/comments'
import { useUiStore } from './ui'

export const useCommentsStore = defineStore('comments', () => {
  // 現在のタスクのコメント一覧
  const comments = ref<Comment[]>([])
  // ローディング状態
  const isLoading = ref(false)
  // コメント送信中の状態
  const isSubmitting = ref(false)

  const uiStore = useUiStore()

  /**
   * タスクのコメント一覧を取得する
   * @param taskId タスク ID
   */
  async function fetchComments(taskId: string): Promise<void> {
    isLoading.value = true
    try {
      comments.value = await commentsApi.fetchComments(taskId)
    } catch (error: any) {
      uiStore.showError('コメントの読み込みに失敗しました')
      console.error('コメント一覧取得エラー:', error)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * コメントを投稿する
   * @param taskId タスク ID
   * @param payload コメント内容
   */
  async function createComment(taskId: string, payload: CreateCommentPayload): Promise<void> {
    isSubmitting.value = true
    try {
      const newComment = await commentsApi.createComment(taskId, payload)
      // 末尾に追加する（作成日時昇順）
      comments.value.push(newComment)
    } catch (error: any) {
      uiStore.showError('コメントの投稿に失敗しました')
      console.error('コメント作成エラー:', error)
      throw error
    } finally {
      isSubmitting.value = false
    }
  }

  /**
   * コメントを削除する（作成者のみ実行可能）
   * @param taskId タスク ID
   * @param commentId コメント ID
   */
  async function deleteComment(taskId: string, commentId: string): Promise<void> {
    try {
      await commentsApi.deleteComment(taskId, commentId)
      comments.value = comments.value.filter((c) => c.commentId !== commentId)
    } catch (error: any) {
      uiStore.showError('コメントの削除に失敗しました')
      console.error('コメント削除エラー:', error)
      throw error
    }
  }

  /** コメント一覧をクリアする（タスク切り替え時） */
  function clearComments(): void {
    comments.value = []
  }

  return {
    comments,
    isLoading,
    isSubmitting,
    fetchComments,
    createComment,
    deleteComment,
    clearComments,
  }
})
