<script setup lang="ts">
// コメントスレッドコンポーネント
// タスク詳細内でコメント一覧の表示と投稿を担当する
import { ref, watch, computed } from 'vue'
import { useCommentsStore } from '@/stores/comments'
import { useAuthStore } from '@/stores/auth'
import { resolveAuthorDisplayName } from '@/utils/displayName'
import type { Comment } from '@/types/comment'

const props = defineProps<{
  taskId: string
}>()

const commentsStore = useCommentsStore()
const authStore = useAuthStore()

// 新しいコメントの入力値
const newCommentContent = ref('')

/**
 * このコンポーネント自身の fetch 待ち。
 * store の isLoading が競合で固着しても、await 完了で必ずスピナーを消せる。
 */
const isLocalFetching = ref(false)
/** watch の古い非同期結果が local フラグを上書きしないための世代 */
let fetchSeq = 0

/** コメントを投稿する */
async function submitComment() {
  const content = newCommentContent.value.trim()
  if (!content || !props.taskId) return

  await commentsStore.createComment(props.taskId, { content })
  newCommentContent.value = ''
}

/** コメントを削除する（作成者のみ） */
async function handleDelete(commentId: string) {
  await commentsStore.deleteComment(props.taskId, commentId)
}

/** 日時をフォーマットする */
function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 投稿者表示名（自分ならクラウド表示名と連動） */
function authorLabel(comment: Comment): string {
  return resolveAuthorDisplayName(comment)
}

/** この taskId 向けのコメント一覧（取り違え防止） */
const visibleComments = computed(() => {
  if (commentsStore.activeTaskId && commentsStore.activeTaskId !== props.taskId) {
    return [] as Comment[]
  }
  return commentsStore.comments
})

/**
 * 初回のみフルスピナー。
 * - ensureComments の await 完了で isLocalFetching が false → 必ず消える
 * - 空一覧でも hasData / lastFetched があれば「まだコメントはありません」を出す
 */
const showInitialLoading = computed(() => {
  if (!isLocalFetching.value && !commentsStore.isLoading) return false

  // すでにこのタスクのデータが確定している（空含む）ならスピナー不要
  if (
    commentsStore.activeTaskId === props.taskId &&
    commentsStore.hasDataForActiveTask
  ) {
    return false
  }

  // コメントが既に見えていればスピナー不要
  if (visibleComments.value.length > 0) return false

  return isLocalFetching.value || commentsStore.isLoading
})

/** 見出し横の小さな更新中インジケータ（初回スピナーと排他） */
const showRefreshingHint = computed(
  () =>
    !showInitialLoading.value &&
    (commentsStore.isRefreshing || isLocalFetching.value) &&
    commentsStore.activeTaskId === props.taskId,
)

// マウント時・taskId 変更時: SWR（キャッシュ優先）
watch(
  () => props.taskId,
  async (taskId) => {
    newCommentContent.value = ''
    if (!taskId) {
      isLocalFetching.value = false
      return
    }

    const seq = ++fetchSeq
    isLocalFetching.value = true
    try {
      await commentsStore.ensureComments(taskId)
    } finally {
      // 古い taskId の結果で新しい表示を壊さない
      if (seq === fetchSeq) {
        isLocalFetching.value = false
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <h3 class="text-subtitle-2 font-weight-bold mb-3 d-flex align-center">
      <v-icon size="16" class="mr-1">mdi-comment-multiple-outline</v-icon>
      コメント（{{ visibleComments.length }} 件）
      <v-progress-circular
        v-if="showRefreshingHint"
        indeterminate
        size="14"
        width="2"
        color="primary"
        class="ml-2"
        title="最新のコメントを確認中"
      />
    </h3>

    <!-- 初回のみローディング（再オープン時はキャッシュを即表示） -->
    <div v-if="showInitialLoading" class="py-4 text-center">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>

    <!-- コメントがない場合の空状態（取得完了後） -->
    <p
      v-else-if="visibleComments.length === 0"
      class="text-body-2 text-medium-emphasis py-3"
    >
      まだコメントはありません。最初のコメントを投稿しましょう。
    </p>

    <!-- コメント一覧（作成日時昇順） -->
    <div v-else class="mb-4">
      <div
        v-for="comment in visibleComments"
        :key="comment.commentId"
        class="mb-3"
      >
        <div class="d-flex align-start">
          <!-- 投稿者アバター -->
          <v-avatar size="32" color="primary" class="mr-3 flex-shrink-0">
            <span style="font-size: 11px; color: white">
              {{ authorLabel(comment).slice(0, 2).toUpperCase() }}
            </span>
          </v-avatar>

          <div class="flex-grow-1">
            <!-- 投稿者名と日時 -->
            <div class="d-flex align-center mb-1">
              <span class="text-caption font-weight-bold mr-2">
                {{ authorLabel(comment) }}
              </span>
              <span class="text-caption text-medium-emphasis">
                {{ formatDateTime(comment.createdAt) }}
              </span>
              <v-spacer />
              <!-- 自分のコメントのみ削除ボタンを表示する -->
              <v-btn
                v-if="comment.authorId === authStore.currentUser?.sub"
                icon="mdi-delete-outline"
                variant="text"
                size="x-small"
                color="error"
                density="compact"
                @click="handleDelete(comment.commentId)"
              />
            </div>

            <!-- コメント本文 -->
            <v-card variant="tonal" rounded="lg" color="surface-variant" class="pa-3">
              <p class="text-body-2 ma-0" style="white-space: pre-wrap">
                {{ comment.content }}
              </p>
            </v-card>
          </div>
        </div>
      </div>
    </div>

    <!-- コメント入力フォーム -->
    <div class="d-flex align-start gap-2">
      <v-avatar size="32" color="primary" class="flex-shrink-0 mt-1">
        <span style="font-size: 11px; color: white">
          {{ (authStore.displayLabel || '?').slice(0, 2).toUpperCase() }}
        </span>
      </v-avatar>
      <div class="flex-grow-1">
        <v-textarea
          v-model="newCommentContent"
          placeholder="コメントを入力してください"
          rows="2"
          auto-grow
          hide-details
          density="compact"
          class="mb-2"
          @keydown.ctrl.enter="submitComment"
        />
        <div class="d-flex justify-end">
          <v-btn
            color="primary"
            size="small"
            :loading="commentsStore.isSubmitting"
            :disabled="!newCommentContent.trim()"
            prepend-icon="mdi-send"
            @click="submitComment"
          >
            コメントを送信する
          </v-btn>
        </div>
      </div>
    </div>
  </div>
</template>
