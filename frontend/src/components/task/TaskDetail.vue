<script setup lang="ts">
// タスク詳細パネル（右サイドのダイアログ）
// タイトル・要望・説明・完了度を前面に出したレイアウト
import { ref, computed, watch } from 'vue'
import { useTasksStore } from '@/stores/tasks'
import { useCommentsStore } from '@/stores/comments'
import {
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  normalizeCompletion,
  completionColor,
  resolveStatusAfterCompletionChange,
} from '@/types/task'
import CommentThread from '@/components/comment/CommentThread.vue'
import TaskForm from './TaskForm.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import axios from 'axios'
import { getUploadUrl, getDownloadUrl, deleteAttachment } from '@/api/comments'
import { useUiStore } from '@/stores/ui'
import {
  resolveAssigneeLabels,
  resolveReviewerLabels,
  avatarLabelFromName,
} from '@/utils/displayName'

const props = defineProps<{
  projectId: string
}>()

const modelValue = defineModel<boolean>({ default: false })
const tasksStore = useTasksStore()
const commentsStore = useCommentsStore()
const uiStore = useUiStore()

const showEditForm = ref(false)
const showDeleteConfirm = ref(false)
const isUploading = ref(false)
const isSavingProgress = ref(false)
/** 詳細画面上の完了度スライダー（即時反映用） */
const localCompletion = ref(0)

const task = computed(() => tasksStore.currentTask)

const assigneeLabels = computed(() =>
  task.value ? resolveAssigneeLabels(task.value) : [],
)

const reviewerLabels = computed(() =>
  task.value ? resolveReviewerLabels(task.value) : [],
)

/**
 * 評価者セクション:
 * - レビュー待ち / 完了 は常に表示（未設定なら「なし」）
 * - それ以外でも評価者が残っていれば表示
 */
const showReviewersSection = computed(
  () =>
    !!task.value &&
    (task.value.status === 'レビュー待ち' ||
      task.value.status === '完了' ||
      reviewerLabels.value.length > 0),
)

// コメント取得は CommentThread 側の ensureComments に一本化
watch(modelValue, (isOpen) => {
  if (!isOpen) {
    commentsStore.deactivate()
  }
})

// タスク切替・再取得時にローカル完了度を同期
watch(
  () => [task.value?.taskId, task.value?.completionPercent, modelValue.value] as const,
  () => {
    if (task.value && modelValue.value) {
      localCompletion.value = normalizeCompletion(task.value.completionPercent)
    }
  },
  { immediate: true },
)

function formatDate(dateStr?: string): string {
  if (!dateStr) return '未設定'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  const d = new Date(dueDate)
  d.setHours(23, 59, 59, 999)
  return d < new Date()
}

async function handleDelete() {
  if (!task.value) return
  await tasksStore.deleteTask(task.value.taskId)
  showDeleteConfirm.value = false
  modelValue.value = false
}

async function commitCompletion(value: number) {
  if (!task.value) return
  const next = normalizeCompletion(value)
  localCompletion.value = next
  if (next === normalizeCompletion(task.value.completionPercent)) return

  // 0→未着手 / 1〜99→進行中 / 100→完了
  // レビュー待ち・保留は完了度を変えてもステータス維持
  const nextStatus = resolveStatusAfterCompletionChange(next, task.value.status)

  isSavingProgress.value = true
  try {
    await tasksStore.updateTask(task.value.taskId, {
      completionPercent: next,
      ...(nextStatus !== task.value.status ? { status: nextStatus } : {}),
    })
  } catch {
    localCompletion.value = normalizeCompletion(task.value.completionPercent)
    uiStore.showError('完了度の更新に失敗しました')
  } finally {
    isSavingProgress.value = false
  }
}

async function handleFileUpload(file: File) {
  if (!task.value) return
  const MAX_SIZE = 50 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    uiStore.showError('ファイルサイズが上限（50MB）を超えています')
    return
  }

  isUploading.value = true
  try {
    const { uploadUrl } = await getUploadUrl(task.value.taskId, {
      filename: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    })
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type },
    })
    uiStore.showSuccess('ファイルをアップロードしました')
    await tasksStore.fetchTask(task.value.taskId)
  } catch {
    uiStore.showError('ファイルのアップロードに失敗しました')
  } finally {
    isUploading.value = false
  }
}

async function handleDownload(attachmentId: string) {
  if (!task.value) return
  try {
    const downloadUrl = await getDownloadUrl(task.value.taskId, attachmentId)
    window.open(downloadUrl, '_blank')
  } catch {
    uiStore.showError('ダウンロード URL の取得に失敗しました')
  }
}

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function close() {
  modelValue.value = false
}

/** アバターは姓のみ */
function initials(name: string): string {
  return avatarLabelFromName(name)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    transition="slide-x-reverse-transition"
    scrim
    retain-focus
    scrollable
    content-class="task-detail-dialog"
    @update:model-value="(v: boolean) => (modelValue = v)"
  >
    <v-card v-if="task" class="task-detail-card d-flex flex-column" rounded="0">
      <!-- ヘッダー -->
      <div class="detail-header flex-grow-0">
        <div class="d-flex align-center px-5 pt-4 pb-2">
          <div class="flex-grow-1 min-w-0">
            <p class="text-caption text-medium-emphasis mb-0 detail-kicker">
              タスク詳細
            </p>
          </div>
          <v-btn
            icon="mdi-pencil-outline"
            variant="tonal"
            color="primary"
            size="small"
            class="mr-1"
            title="編集"
            @click="showEditForm = true"
          />
          <v-btn
            icon="mdi-delete-outline"
            variant="text"
            size="small"
            color="error"
            title="削除"
            @click="showDeleteConfirm = true"
          />
          <v-btn icon="mdi-close" variant="text" size="small" @click="close" />
        </div>

        <!-- タイトル（最重要） -->
        <div class="px-5 pb-4">
          <h1 class="detail-title mb-4">
            {{ task.title }}
          </h1>
          <div class="d-flex flex-wrap align-center ga-2">
            <v-chip
              :color="STATUS_COLORS[task.status]"
              size="default"
              label
              variant="flat"
              class="font-weight-medium"
            >
              {{ task.status }}
            </v-chip>
            <v-chip
              :color="PRIORITY_COLORS[task.priority]"
              size="default"
              label
              variant="tonal"
            >
              優先度: {{ PRIORITY_LABELS[task.priority] }}
            </v-chip>
            <v-chip
              v-if="task.dueDate"
              size="default"
              label
              :color="isOverdue(task.dueDate) ? 'error' : 'default'"
              :variant="isOverdue(task.dueDate) ? 'flat' : 'tonal'"
              prepend-icon="mdi-calendar"
            >
              {{ formatDate(task.dueDate) }}
              <span v-if="isOverdue(task.dueDate)" class="ml-1">（締切超過）</span>
            </v-chip>
          </div>
        </div>
      </div>

      <div class="task-detail-body flex-grow-1">
        <!-- 要望（ハイライト） -->
        <section class="detail-section mx-5 mt-4 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-bullseye-arrow</v-icon>
            要望
          </div>
          <div v-if="task.requirement?.trim()" class="requirement-card">
            <p class="requirement-text ma-0">{{ task.requirement }}</p>
          </div>
          <div v-else class="empty-block">
            要望は未登録です。編集画面からご記入ください。
          </div>
        </section>

        <!-- 説明 -->
        <section class="detail-section mx-5 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-text-box-outline</v-icon>
            説明
          </div>
          <div v-if="task.description?.trim()" class="description-card">
            <p class="description-text ma-0">{{ task.description }}</p>
          </div>
          <div v-else class="empty-block">
            説明は未登録です。背景や手順は編集画面からご記入ください。
          </div>
        </section>

        <!-- 完了度（説明の下・担当者の上・コンパクト） -->
        <section class="detail-section completion-section mx-5 mb-4">
          <div class="completion-row">
            <div class="section-label completion-label mb-0">
              <v-icon size="16" class="mr-1" color="primary">mdi-progress-check</v-icon>
              完了度
            </div>
            <v-slider
              v-model="localCompletion"
              :min="0"
              :max="100"
              :step="5"
              :color="completionColor(localCompletion)"
              :disabled="isSavingProgress"
              density="compact"
              hide-details
              class="completion-slider"
              @end="commitCompletion(localCompletion)"
            />
            <v-text-field
              v-model.number="localCompletion"
              type="number"
              min="0"
              max="100"
              density="compact"
              variant="outlined"
              hide-details
              hide-spin-buttons
              class="completion-input"
              suffix="%"
              :disabled="isSavingProgress"
              @change="commitCompletion(localCompletion)"
            />
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              :loading="isSavingProgress"
              class="completion-btn"
              @click="commitCompletion(localCompletion)"
            >
              適用
            </v-btn>
          </div>
        </section>

        <!-- 担当者 -->
        <section class="detail-section mx-5 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-account-multiple-outline</v-icon>
            担当者
          </div>
          <div v-if="assigneeLabels.length" class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="(label, idx) in assigneeLabels"
              :key="`${label}-${idx}`"
              color="primary"
              variant="tonal"
              size="large"
              class="font-weight-medium"
            >
              <v-avatar start size="28" color="primary">
                <span class="text-caption text-white">{{ initials(label) }}</span>
              </v-avatar>
              {{ label }}
            </v-chip>
          </div>
          <div v-else class="empty-block">未割当</div>
        </section>

        <!-- 評価者（レビュー待ち / 完了で設定済みなら保持表示） -->
        <section v-if="showReviewersSection" class="detail-section mx-5 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-account-check-outline</v-icon>
            評価者
          </div>
          <div v-if="reviewerLabels.length" class="d-flex flex-wrap ga-2">
            <v-chip
              v-for="(label, idx) in reviewerLabels"
              :key="`rev-${label}-${idx}`"
              color="warning"
              variant="tonal"
              size="large"
              class="font-weight-medium"
            >
              <v-avatar start size="28" color="warning">
                <span class="text-caption text-white">{{ initials(label) }}</span>
              </v-avatar>
              {{ label }}
            </v-chip>
          </div>
          <div v-else class="empty-block">
            <template v-if="task.status === 'レビュー待ち'">
              未設定です。編集からプロジェクトメンバーを評価者に指定できます。
            </template>
            <template v-else>なし</template>
          </div>
        </section>

        <!-- 属性グリッド: 開始 / 工数 / 締切 / 作成・更新 -->
        <section class="meta-grid mx-5 mb-5">
          <div class="meta-item">
            <span class="meta-key">開始日</span>
            <span class="meta-val">{{ formatDate(task.startDate) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-key">予定工数（人日）</span>
            <span class="meta-val">
              <template v-if="task.estimatedEffortDays != null">
                {{ task.estimatedEffortDays }} 人日
              </template>
              <template v-else>未設定</template>
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-key">締切日</span>
            <span
              class="meta-val"
              :class="{ 'text-error font-weight-bold': isOverdue(task.dueDate) }"
            >
              {{ formatDate(task.dueDate) }}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-key">作成日</span>
            <span class="meta-val">{{ formatDateTime(task.createdAt) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-key">更新日</span>
            <span class="meta-val">{{ formatDateTime(task.updatedAt) }}</span>
          </div>
        </section>

        <v-divider class="mb-4 mx-5" />

        <!-- 添付 -->
        <section class="detail-section mx-5 mb-4">
          <div class="section-label mb-2">
            <v-icon size="18" class="mr-1">mdi-paperclip</v-icon>
            添付ファイル（{{ task.attachments?.length ?? 0 }} 件）
          </div>

          <div v-if="task.attachments?.length" class="attachment-list mb-3">
            <div
              v-for="attachment in task.attachments"
              :key="attachment.attachmentId"
              class="attachment-row"
            >
              <v-icon size="18" class="mr-2 text-medium-emphasis">mdi-file-outline</v-icon>
              <span
                class="text-body-2 text-primary flex-grow-1 text-truncate attachment-name"
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

          <v-file-input
            label="ファイルを添付する"
            prepend-icon="mdi-upload"
            hide-details
            density="compact"
            variant="outlined"
            :loading="isUploading"
            @update:model-value="
              (files: File | File[]) => {
                const file = Array.isArray(files) ? files[0] : files
                if (file) handleFileUpload(file)
              }
            "
          />
        </section>

        <v-divider class="mb-4 mx-5" />

        <div class="px-5 pb-8">
          <CommentThread
            v-if="modelValue && task.taskId"
            :key="`comments-${task.taskId}`"
            :task-id="task.taskId"
          />
        </div>
      </div>
    </v-card>

    <v-card v-else class="task-detail-card pa-8" rounded="0">
      <p class="text-body-1 text-medium-emphasis">タスク情報を表示できません</p>
      <v-btn class="mt-3" variant="text" @click="close">閉じる</v-btn>
    </v-card>
  </v-dialog>

  <TaskForm
    v-if="task"
    v-model="showEditForm"
    :project-id="projectId"
    :task="task"
  />

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

<style>
/* content-class は teleported 要素に付くため非 scoped */
.task-detail-dialog.v-overlay__content {
  position: fixed !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: auto !important;
  margin: 0 !important;
  height: 100% !important;
  max-height: 100% !important;
  /* 画面の約 48% まで広げ、最小でも読みやすい幅を確保 */
  width: min(720px, 100vw) !important;
  max-width: min(720px, 100vw) !important;
  align-self: stretch !important;
}

@media (min-width: 1400px) {
  .task-detail-dialog.v-overlay__content {
    width: min(780px, 48vw) !important;
    max-width: min(780px, 48vw) !important;
  }
}
</style>

<style scoped>
.task-detail-card {
  height: 100%;
  max-height: 100vh;
  background: rgb(var(--v-theme-surface));
}

.detail-header {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: linear-gradient(
    165deg,
    rgba(var(--v-theme-primary), 0.1) 0%,
    rgba(var(--v-theme-primary), 0.03) 45%,
    rgba(var(--v-theme-surface), 1) 100%
  );
}

.detail-kicker {
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.72rem !important;
  font-weight: 600;
}

.detail-title {
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.35;
  word-break: break-word;
  letter-spacing: -0.02em;
  color: rgba(var(--v-theme-on-surface), 0.95);
}

.task-detail-body {
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  -webkit-overflow-scrolling: touch;
}

.detail-section {
  min-width: 0;
}

.section-label {
  display: flex;
  align-items: center;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 10px;
}

.completion-section {
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.12);
  overflow: visible;
}

.completion-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
  min-width: 0;
}

.completion-label {
  flex: 0 0 auto;
  margin-bottom: 0 !important;
  white-space: nowrap;
}

.completion-slider {
  flex: 1 1 auto;
  min-width: 64px;
  max-width: 100%;
  margin-inline: 0;
}

/* 数字入力が % サフィックスで欠けないよう十分な幅を確保 */
.completion-input {
  flex: 0 0 104px;
  width: 104px;
  max-width: 104px;
  min-width: 104px;
  flex-shrink: 0;
}

.completion-input :deep(.v-field) {
  font-size: 0.9rem;
  font-weight: 600;
}

.completion-input :deep(.v-field__input) {
  min-height: 36px;
  padding-top: 4px;
  padding-bottom: 4px;
  text-align: right;
  /* 3桁 + 余白 */
  min-width: 2.5rem;
}

.completion-input :deep(.v-text-field__suffix),
.completion-input :deep(.v-field__append-inner) {
  opacity: 0.75;
  padding-inline-start: 2px;
}

.completion-btn {
  flex: 0 0 auto;
  flex-shrink: 0;
}

@media (max-width: 480px) {
  .completion-row {
    flex-wrap: wrap;
  }
  .completion-slider {
    order: 5;
    flex: 1 1 100%;
    min-width: 100%;
  }
  .completion-input {
    flex: 1 1 auto;
    width: auto;
    max-width: 140px;
  }
}

.requirement-card {
  padding: 18px 20px;
  border-radius: 14px;
  background: rgba(var(--v-theme-warning), 0.12);
  border-left: 5px solid rgb(var(--v-theme-warning));
}

.requirement-text {
  font-size: 1.05rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.description-card {
  padding: 18px 20px;
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 88px;
}

.description-text {
  font-size: 1rem;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(var(--v-theme-on-surface), 0.88);
}

.empty-block {
  font-size: 0.92rem;
  color: rgba(var(--v-theme-on-surface), 0.45);
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 14px;
}

.meta-item {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
}

.meta-key {
  display: block;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
  margin-bottom: 4px;
}

.meta-val {
  font-size: 0.95rem;
  font-weight: 600;
}

.attachment-list {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  overflow: hidden;
}

.attachment-row {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.attachment-row:last-child {
  border-bottom: none;
}

.attachment-name {
  cursor: pointer;
}

.attachment-name:hover {
  text-decoration: underline;
}

.min-w-0 {
  min-width: 0;
}
</style>
