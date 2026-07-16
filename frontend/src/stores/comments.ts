// コメント管理ストア（タスク単位 SWR キャッシュ）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Comment, CreateCommentPayload } from '@/types/comment'
import * as commentsApi from '@/api/comments'
import { useUiStore } from './ui'
import { useAuthStore } from './auth'
import { useDisplayNamesStore } from './displayNames'

/** キャッシュ新鮮期間（再オープン時はこの間 API を打たない） */
const FRESH_MS = 30_000

interface TaskCommentsCache {
  comments: Comment[]
  fetchedAt: number
  fingerprint: string
}

/** 差分判定用フィンガープリント */
export function commentsFingerprint(list: Comment[]): string {
  return list
    .map(
      (c) =>
        [c.commentId, c.updatedAt, c.content, c.authorId, c.authorName ?? ''].join(':'),
    )
    .sort()
    .join('|')
}

export const useCommentsStore = defineStore('comments', () => {
  const comments = ref<Comment[]>([])
  const activeTaskId = ref<string | null>(null)
  /** 初回ロード（キャッシュ無し）のみ true */
  const isLoading = ref(false)
  /** バックグラウンド再取得中 */
  const isRefreshing = ref(false)
  const isSubmitting = ref(false)
  const lastFetchedAt = ref(0)

  const cacheByTask = new Map<string, TaskCommentsCache>()
  /** 同一 taskId の並行 ensure を 1 本にまとめる */
  const inflightByTask = new Map<string, Promise<void>>()
  /**
   * ensure 実行世代。finally で古いリクエストがフラグを壊さないようにする
   * （別タスク切替や force 再取得との競合対策）
   */
  let ensureGeneration = 0

  const uiStore = useUiStore()

  const hasDataForActiveTask = computed(() => {
    if (!activeTaskId.value) return false
    if (lastFetchedAt.value > 0) return true
    return cacheByTask.has(activeTaskId.value)
  })

  function clearLoadingFlags(): void {
    isLoading.value = false
    isRefreshing.value = false
  }

  function saveCache(taskId: string): void {
    cacheByTask.set(taskId, {
      comments: comments.value.map((c) => ({ ...c })),
      fetchedAt: lastFetchedAt.value,
      fingerprint: commentsFingerprint(comments.value),
    })
  }

  function restoreCache(taskId: string): boolean {
    const cached = cacheByTask.get(taskId)
    if (!cached) return false
    comments.value = cached.comments.map((c) => ({ ...c }))
    activeTaskId.value = taskId
    lastFetchedAt.value = cached.fetchedAt
    return true
  }

  async function applyDisplayNames(list: Comment[]): Promise<void> {
    const displayNames = useDisplayNamesStore()
    displayNames.ingestComments(list)
    const authorIds = list.map((c) => c.authorId).filter(Boolean)
    if (authorIds.length > 0) {
      try {
        await displayNames.refreshUserIds(authorIds)
      } catch (e) {
        // 表示名失敗でもコメント一覧自体は表示する
        console.warn('コメント投稿者名の解決に失敗:', e)
      }
    }
  }

  /**
   * API から取得。
   * - 空一覧・差分なしでも lastFetchedAt / キャッシュを更新する
   * - 一覧代入は差分なしでも行い、空状態の UI 更新を確実にする
   * - 表示名解決はロード完了をブロックしない（呼び出し側で fire-and-forget）
   */
  async function loadFromApi(taskId: string): Promise<Comment[]> {
    const data = await commentsApi.fetchComments(taskId)
    // 別タスクへ切り替わっていたら反映しない
    if (activeTaskId.value !== taskId) return []

    const raw = Array.isArray(data) ? data : []
    const filtered = raw.filter((c) => !c.taskId || c.taskId === taskId)
    const nextFp = commentsFingerprint(filtered)
    const prevFp = commentsFingerprint(comments.value)
    const changed = prevFp !== nextFp || comments.value.length !== filtered.length

    // 差分がなくても配列を確定代入（空→空でも「ロード済み」を UI に伝える）
    comments.value = filtered
    lastFetchedAt.value = Date.now()

    if (activeTaskId.value === taskId) {
      saveCache(taskId)
    }

    // 変化があったときだけ表示名解決を返す（呼び出し側で await しない想定）
    return changed ? filtered : []
  }

  async function runEnsure(
    taskId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const force = options?.force ?? false
    const generation = ++ensureGeneration

    // 別タスクへ切替: 現在分を保存しキャッシュを先に出す
    if (activeTaskId.value && activeTaskId.value !== taskId) {
      saveCache(activeTaskId.value)
      const restored = restoreCache(taskId)
      if (!restored) {
        comments.value = []
        activeTaskId.value = taskId
        lastFetchedAt.value = 0
      }
    } else if (!activeTaskId.value) {
      const restored = restoreCache(taskId)
      if (!restored) {
        activeTaskId.value = taskId
        comments.value = []
        lastFetchedAt.value = 0
      }
    } else {
      activeTaskId.value = taskId
    }

    const hasCache =
      activeTaskId.value === taskId &&
      (lastFetchedAt.value > 0 || cacheByTask.has(taskId))

    const isFresh =
      !force &&
      activeTaskId.value === taskId &&
      lastFetchedAt.value > 0 &&
      Date.now() - lastFetchedAt.value < FRESH_MS

    if (hasCache && isFresh) {
      // ロード中フラグが残っていたら必ず下ろす
      if (generation === ensureGeneration) {
        clearLoadingFlags()
      }
      return
    }

    const useHardLoading = !hasCache
    if (useHardLoading) {
      isLoading.value = true
      isRefreshing.value = false
    } else {
      isRefreshing.value = true
    }

    try {
      const forNames = await loadFromApi(taskId)
      // ロード完了フラグは表示名 API を待たずに下ろす（スピナー固着の主因を排除）
      if (generation === ensureGeneration) {
        clearLoadingFlags()
      }
      if (forNames.length > 0 && activeTaskId.value === taskId) {
        void applyDisplayNames(forNames).catch(() => {
          /* 表示名失敗は一覧表示に影響させない */
        })
      }
    } catch (error: unknown) {
      if (activeTaskId.value === taskId) {
        if (useHardLoading) {
          uiStore.showError('コメントの読み込みに失敗しました')
        }
        console.error('コメント一覧取得エラー:', error)
      }
    } finally {
      // 成功・失敗・差分なし・表示名待ち いずれでもフラグを下ろす
      // 古い generation は触らない（後続 ensure のフラグを壊さない）
      if (generation === ensureGeneration) {
        clearLoadingFlags()
      }
    }
  }

  /**
   * コメント一覧を用意する（SWR + 同一タスクの in-flight 共有）
   */
  async function ensureComments(
    taskId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    if (!taskId) return

    const force = options?.force ?? false
    const existing = inflightByTask.get(taskId)
    // 強制再取得でなければ、進行中の同じ taskId リクエストに合流
    if (existing && !force) {
      return existing
    }

    const promise = runEnsure(taskId, options).finally(() => {
      if (inflightByTask.get(taskId) === promise) {
        inflightByTask.delete(taskId)
      }
    })
    inflightByTask.set(taskId, promise)
    return promise
  }

  /** @deprecated ensureComments を推奨 */
  async function fetchComments(taskId: string): Promise<void> {
    await ensureComments(taskId, { force: true })
  }

  async function createComment(taskId: string, payload: CreateCommentPayload): Promise<void> {
    if (activeTaskId.value && activeTaskId.value !== taskId) {
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

      if (activeTaskId.value === taskId && newComment.taskId === taskId) {
        comments.value.push(newComment)
        lastFetchedAt.value = Date.now()
        saveCache(taskId)
        useDisplayNamesStore().ingestComments([newComment])
      }
    } catch (error: unknown) {
      uiStore.showError('コメントの投稿に失敗しました')
      console.error('コメント作成エラー:', error)
      throw error
    } finally {
      isSubmitting.value = false
    }
  }

  async function deleteComment(taskId: string, commentId: string): Promise<void> {
    try {
      await commentsApi.deleteComment(taskId, commentId)
      if (activeTaskId.value === taskId) {
        comments.value = comments.value.filter((c) => c.commentId !== commentId)
        lastFetchedAt.value = Date.now()
        saveCache(taskId)
      } else {
        const cached = cacheByTask.get(taskId)
        if (cached) {
          cached.comments = cached.comments.filter((c) => c.commentId !== commentId)
          cached.fingerprint = commentsFingerprint(cached.comments)
          cached.fetchedAt = Date.now()
        }
      }
    } catch (error: unknown) {
      uiStore.showError('コメントの削除に失敗しました')
      console.error('コメント削除エラー:', error)
      throw error
    }
  }

  function deactivate(): void {
    if (activeTaskId.value) {
      saveCache(activeTaskId.value)
    }
    // スピナーが残らないようフラグを下ろす
    clearLoadingFlags()
  }

  function clearComments(): void {
    if (activeTaskId.value) {
      saveCache(activeTaskId.value)
    }
    inflightByTask.clear()
    ensureGeneration += 1
    activeTaskId.value = null
    comments.value = []
    lastFetchedAt.value = 0
    clearLoadingFlags()
  }

  function invalidate(taskId?: string): void {
    if (taskId) {
      cacheByTask.delete(taskId)
      inflightByTask.delete(taskId)
      if (activeTaskId.value === taskId) lastFetchedAt.value = 0
    } else {
      cacheByTask.clear()
      inflightByTask.clear()
      lastFetchedAt.value = 0
    }
  }

  return {
    comments,
    activeTaskId,
    isLoading,
    isRefreshing,
    isSubmitting,
    hasDataForActiveTask,
    ensureComments,
    fetchComments,
    createComment,
    deleteComment,
    deactivate,
    clearComments,
    invalidate,
  }
})
