<script setup lang="ts">
// タスク詳細サイドドロワーコンポーネント
// タスクの全フィールド表示、編集、コメント、添付ファイルを管理する
import { ref, computed, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useCommentsStore } from '@/stores/comments'
import type { Task } from '@/types/task'
import { STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/task'
import CommentThread from '@/components/comment/CommentThread.vue'
import TaskForm from './TaskForm.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import axios from 'axios'
import { getUploadUrl, getDownloadUrl, deleteAttachment } from '@/api/comments'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{
  projectId: string
}>()

const modelValue = defineModel<boolean>()
const tasksStore = useTasksStore()
const commentsStore = useCommentsStore()
const uiStore = useUiStore()

// 編集フォームダイアログの表示状態
const showEditForm = ref(false)
// 削除確認ダイアログの表示状態
const showDeleteConfirm = ref(false)
// ファイルアップロード中の状態
const isUploading = ref(false)

/** 現在表示中のタスク */
const task = computed(() => tasksStore.currentTask)

/** ドロワーが閉じられたときにコメントをクリアする */
watch(modelValue, (isOpen) => {
  if (!isOpen) {
    commentsStore.clearComments()
  }
})

/** 日付をフォーマットする */
function formatDate(dateStr?: string): string {
  if (!dateStr) return '未設定'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
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

/** タスクを削除する */
async function handleDelete() {
  if (!task.value) return
  await tasksStore.deleteTask(task.value.taskId)
  showDeleteConfirm.value = false
  modelValue.value = false
}

/**
 * ファイルをアップロードする
 * プリサインド PUT URL 経由で S3 に直接アップロードする
 */
async function handleFileUpload(file: File) {
  if (!task.value) return

  // 50MB のファイルサイズ制限をフロントエンドで確認する
  const MAX_SIZE = 50 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    uiStore.showError('ファイルサイズが上限（50MB）を超えています')
    return
  }

  isUploading.value = true
  try {
    // プリサインド PUT URL を取得する
    const { uploadUrl, attachmentId } = await getUploadUrl(task.value.taskId, {
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })

    // S3 へ直接アップロードする（Lambda を経由しない）
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type },
    })

    uiStore.showSuccess('ファイルをアップロードしました')

    // タスクの最新情報を取得して添付ファイル一覧を更新する
    await tasksStore.fetchTask(task.value.taskId)
  } catch {
    uiStore.showError('ファイルのアップロードに失敗しました')
  } finally {
    isUploading.value = false
  }
}

/** ファイルをダウンロードする（プリサインド GET URL 経由） */
async function handleDownload(attachmentId: string) {
  if (!task.value) return
  try {
    const downloadUrl = await getDownloadUrl(task.value.taskId, attachmentId)
    window.open(downloadUrl, '_blank')
  } catch {
    uiStore.showError('ダウンロード URL の取得に失敗しました')
  }
}

/** 添付ファイルを削除する */
async function handleDeleteAttachment(attachmentId: string) {
  if (!task.value) return
  try {
    await deleteAttachment(task.value.taskId, attachmentId)
    await tasksStore.fetchTask(task.value.taskId)
    uiStore.showSuccess('ファイルを削除しました')
  } catch {
    uiStore.showError('ファイルの削除に失敗しました')
  }
}

/** ファイルサイズを人が読みやすい形式に変換する */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <v-navigation-drawer
    v-model="modelValue"
    location="right"
    width="480"
    temporary
  >
    <template v-if="task">
      <!-- ドロワーヘッダー -->
      <v-toolbar density="compact" color="surface" border="b">
        <v-toolbar-title class="text-subtitle-2 font-weight-bold">
          タスク詳細
        </v-toolbar-title>
        <template #append>
          <!-- 編集ボタン -->
          <v-btn
            icon="mdi-pencil"
            variant="text"
            size="small"
            @click="showEditForm = true"
          />
          <!-- 削除ボタン -->
          <v-btn
            icon="mdi-delete"
            variant="text"
            size="small"
            color="error"
            @click="showDeleteConfirm = true"
          />
          <!-- 閉じるボタン -->
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            @click="modelValue = false"
          />
        </template>
      </v-toolbar>

      <!-- スクロール可能なコンテンツエリア -->
      <div class="pa-4 overflow-y-auto" style="height: calc(100% - 48px)">
        <!-- タイトル -->
        <h2 class="text-subtitle-1 font-weight-bold mb-3">{{ task.title }}</h2>

        <!-- ステータスと優先度 -->
        <div class="d-flex gap-2 mb-4">
          <v-chip :color="STATUS_COLORS[task.status]" size="small" label variant="tonal">
            {{ task.status }}
          </v-chip>
          <v-chip :color="PRIORITY_COLORS[task.priority]" size="small" label variant="tonal">
            {{ PRIORITY_LABELS[task.priority] }}
          </v-chip>
        </div>

        <!-- 詳細フィールド一覧 -->
        <v-table density="compact" class="mb-4">
          <tbody>
            <tr v-if="task.location">
              <td class="text-caption text-medium-emphasis" style="width: 80px">場所</td>
              <td class="text-body-2">{{ task.location }}</td>
            </tr>
            <tr v-if="task.requirement">
              <td class="text-caption text-medium-emphasis">要望</td>
              <td class="text-body-2">{{ task.requirement }}</td>
            </tr>
            <tr>
              <td class="text-caption text-medium-emphasis">担当者</td>
              <td class="text-body-2">{{ task.assigneeName || task.assigneeId || '未割り当て' }}</td>
            </tr>
            <tr>
              <td class="text-caption text-medium-emphasis">期日</td>
              <td class="text-body-2">{{ formatDate(task.dueDate) }}</td>
            </tr>
            <tr>
              <td class="text-caption text-medium-emphasis">作成日</td>
              <td class="text-caption text-medium-emphasis">{{ formatDateTime(task.createdAt) }}</td>
            </tr>
            <tr>
              <td class="text-caption text-medium-emphasis">更新日</td>
              <td class="text-caption text-medium-emphasis">{{ formatDateTime(task.updatedAt) }}</td>
            </tr>
          </tbody>
        </v-table>

        <!-- 説明 -->
        <div v-if="task.description" class="mb-4">
          <p class="text-caption font-weight-bold text-medium-emphasis mb-1">説明</p>
          <p class="text-body-2" style="white-space: pre-wrap">{{ task.description }}</p>
        </div>

        <v-divider class="mb-4" />

        <!-- 添付ファイルセクション -->
        <div class="mb-4">
          <p class="text-caption font-weight-bold text-medium-emphasis mb-2">
            <v-icon size="14" class="mr-1">mdi-paperclip</v-icon>
            添付ファイル（{{ task.attachments?.length ?? 0 }} 件）
          </p>

          <!-- 添付ファイル一覧 -->
          <div v-if="task.attachments?.length" class="mb-2">
            <div
              v-for="attachment in task.attachments"
              :key="attachment.attachmentId"
              class="d-flex align-center py-1"
            >
              <v-icon size="16" class="mr-2 text-medium-emphasis">mdi-file-outline</v-icon>
              <span
                class="text-body-2 text-primary cursor-pointer flex-grow-1 text-truncate"
                style="cursor: pointer"
                @click="handleDownload(attachment.attachmentId)"
              >
                {{ attachment.filename }}
              </span>
              <span class="text-caption text-medium-emphasis mr-2">
                {{ formatFileSize(attachment.sizeBytes) }}
              </span>
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                size="x-small"
                color="error"
                density="compact"
                @click="handleDeleteAttachment(attachment.attachmentId)"
              />
            </div>
          </div>

          <!-- ファイルアップロード入力 -->
          <v-file-input
            label="ファイルを添付する"
            prepend-icon="mdi-upload"
            hide-details
            density="compact"
            :loading="isUploading"
            @update:model-value="(files: File | File[]) => {
              const file = Array.isArray(files) ? files[0] : files
              if (file) handleFileUpload(file)
            }"
          />
        </div>

        <v-divider class="mb-4" />

        <!-- コメントスレッド -->
        <CommentThread :task-id="task.taskId" />
      </div>
    </template>
  </v-navigation-drawer>

  <!-- タスク編集フォームダイアログ -->
  <TaskForm
    v-if="task"
    v-model="showEditForm"
    :project-id="projectId"
    :task="task"
  />

  <!-- 削除確認ダイアログ -->
  <ConfirmDialog
    v-model="showDeleteConfirm"
    title="タスクを削除しますか？"
    :message="`「${task?.title}」を削除します。この操作は元に戻せません。`"
    confirm-text="削除する"
    confirm-color="error"
    :loading="tasksStore.isLoading"
    @confirm="handleDelete"
  />
</template>
