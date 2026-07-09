<script setup lang="ts">
// コメントスレッドコンポーネント
// タスク詳細内でコメント一覧の表示と投稿を担当する
import { ref, watch } from 'vue'
import { useCommentsStore } from '@/stores/comments'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  taskId: string
}>()

const commentsStore = useCommentsStore()
const authStore = useAuthStore()

// 新しいコメントの入力値
const newCommentContent = ref('')

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

// タスク ID が変わったら必ずコメントを再取得する（マウント時含む）
// 以前は onMounted のみだったため、ドロワー内でタスクを切り替えると
// 別タスクのコメントが表示されたままになる不具合があった
watch(
  () => props.taskId,
  (taskId) => {
    newCommentContent.value = ''
    if (taskId) {
      commentsStore.fetchComments(taskId)
    } else {
      commentsStore.clearComments()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <h3 class="text-subtitle-2 font-weight-bold mb-3">
      <v-icon size="16" class="mr-1">mdi-comment-multiple-outline</v-icon>
      コメント（{{ commentsStore.comments.length }} 件）
    </h3>

    <!-- ローディング中の表示 -->
    <div v-if="commentsStore.isLoading" class="py-4 text-center">
      <v-progress-circular indeterminate size="24" color="primary" />
    </div>

    <!-- コメントがない場合の空状態 -->
    <p
      v-else-if="commentsStore.comments.length === 0"
      class="text-body-2 text-medium-emphasis py-3"
    >
      まだコメントはありません。最初のコメントを投稿しましょう。
    </p>

    <!-- コメント一覧（作成日時昇順） -->
    <div v-else class="mb-4">
      <div
        v-for="comment in commentsStore.comments"
        :key="comment.commentId"
        class="mb-3"
      >
        <div class="d-flex align-start">
          <!-- 投稿者アバター -->
          <v-avatar size="32" color="primary" class="mr-3 flex-shrink-0">
            <span style="font-size: 11px; color: white">
              {{ (comment.authorName || comment.authorId).slice(0, 2).toUpperCase() }}
            </span>
          </v-avatar>

          <div class="flex-grow-1">
            <!-- 投稿者名と日時 -->
            <div class="d-flex align-center mb-1">
              <span class="text-caption font-weight-bold mr-2">
                {{ comment.authorName || comment.authorId }}
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
