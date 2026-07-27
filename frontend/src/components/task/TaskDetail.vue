<script setup lang="ts">
// タスク詳細パネル（右サイドのダイアログ）
// タイトル・要件・説明・進捗を前面に出したレイアウト
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
  getPlannedDueDate,
  getPlannedStartDate,
  isPlannedDueOverdue,
  type Attachment,
  type DeliverableCheckItem,
  type Task,
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
import {
  breadcrumbPath,
  childrenOf,
  displaySchedule,
  isParentTask,
} from '@/utils/wbs'
import {
  completeBlockMessage,
  newCheckItem,
  reviewSoftWarnMessage,
} from '@/utils/deliverable'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  projectId: string
}>()

const modelValue = defineModel<boolean>({ default: false })
const tasksStore = useTasksStore()
const commentsStore = useCommentsStore()
const uiStore = useUiStore()
const authStore = useAuthStore()

const showEditForm = ref(false)
const showDeleteConfirm = ref(false)
const isUploading = ref(false)
const isSavingProgress = ref(false)
const isSavingDeliverable = ref(false)
/** 詳細画面上の完了度スライダー（即時反映用） */
const localCompletion = ref(0)
/** 添付時に成果物として提出するか */
const uploadAsDeliverable = ref(false)
/** 選択済み・未アップロードのファイル（即時 API しない） */
const pendingUploadFile = ref<File | null>(null)

const task = computed(() => tasksStore.currentTask)

const assigneeLabels = computed(() =>
  task.value ? resolveAssigneeLabels(task.value) : [],
)

const reviewerLabels = computed(() =>
  task.value ? resolveReviewerLabels(task.value) : [],
)

const schedule = computed(() =>
  task.value
    ? displaySchedule(task.value)
    : {
        completionPercent: 0,
        isRollup: false,
      },
)

const plannedStart = computed(
  () =>
    schedule.value.plannedStartDate ??
    (task.value ? getPlannedStartDate(task.value) : undefined),
)
const plannedDue = computed(
  () =>
    schedule.value.plannedDueDate ??
    (task.value ? getPlannedDueDate(task.value) : undefined),
)

const crumbs = computed(() => {
  if (!task.value) return []
  return breadcrumbPath(task.value, tasksStore.activeTasks)
})

const childTasks = computed(() => {
  if (!task.value) return []
  return childrenOf(tasksStore.activeTasks, task.value.taskId)
})

const isParent = computed(
  () => !!(task.value && isParentTask(task.value, tasksStore.activeTasks)),
)

/** 子孫タスクから集めた成果物ファイル（親詳細用・通常添付は含めない） */
const descendantDeliverables = computed(() => {
  if (!task.value || !isParent.value) return [] as Array<{
    attachment: Attachment
    source: Task
  }>
  const rootId = task.value.taskId
  const all = tasksStore.activeTasks
  const byParent = new Map<string, Task[]>()
  for (const t of all) {
    const key = t.parentTaskId || ''
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(t)
  }
  const descendants: Task[] = []
  const stack = [...(byParent.get(rootId) ?? [])]
  while (stack.length) {
    const cur = stack.pop()!
    descendants.push(cur)
    const kids = byParent.get(cur.taskId)
    if (kids?.length) stack.push(...kids)
  }
  const out: Array<{ attachment: Attachment; source: Task }> = []
  for (const t of descendants) {
    for (const a of t.attachments ?? []) {
      if (a.kind === 'deliverable') {
        out.push({ attachment: a, source: t })
      }
    }
  }
  // WBS 順っぽく: ソースの wbs → ファイル名
  out.sort((a, b) => {
    const wa = a.source.wbsCode || ''
    const wb = b.source.wbsCode || ''
    if (wa !== wb) {
      return wa.localeCompare(wb, undefined, { numeric: true })
    }
    return a.attachment.filename.localeCompare(b.attachment.filename, 'ja')
  })
  return out
})

/**
 * 実績 vs 予定の比較クラス
 * - ok: 予定と同じ or 早い / 工数が予定以内 → 浅绿
 * - late: 予定より遅い / 工数超過 → 浅红
 * - どちらか未設定 → ニュートラル
 */
type ActualVsPlanTone = 'ok' | 'late' | null

function compareDateVsPlan(
  actual?: string | null,
  planned?: string | null,
): ActualVsPlanTone {
  if (!actual || !planned) return null
  const a = actual.slice(0, 10)
  const p = planned.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(p)) return null
  if (a <= p) return 'ok'
  return 'late'
}

function compareEffortVsPlan(
  actual?: number | null,
  planned?: number | null,
): ActualVsPlanTone {
  if (actual == null || planned == null || Number.isNaN(Number(actual)) || Number.isNaN(Number(planned))) {
    return null
  }
  if (Number(actual) <= Number(planned)) return 'ok'
  return 'late'
}

function actualToneClass(tone: ActualVsPlanTone): string {
  if (tone === 'ok') return 'meta-item--ok'
  if (tone === 'late') return 'meta-item--late'
  return ''
}

const actualStartTone = computed((): ActualVsPlanTone =>
  compareDateVsPlan(schedule.value.actualStartDate, plannedStart.value),
)
const actualEndTone = computed((): ActualVsPlanTone =>
  compareDateVsPlan(schedule.value.actualDueDate, plannedDue.value),
)
const actualEffortTone = computed((): ActualVsPlanTone =>
  compareEffortVsPlan(
    schedule.value.actualEffortDays,
    schedule.value.estimatedEffortDays,
  ),
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

// タスク切替・再取得時にローカル完了度を同期（親は rollup）
watch(
  () =>
    [
      task.value?.taskId,
      task.value?.completionPercent,
      task.value?.rollup?.completionPercent,
      task.value?.childCount,
      modelValue.value,
    ] as const,
  () => {
    if (task.value && modelValue.value) {
      localCompletion.value = displaySchedule(task.value).completionPercent
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
  // 有効ステータス（親は rollup）を見て超過ハイライト
  const st =
    task.value?.rollup && (task.value.childCount ?? 0) > 0
      ? task.value.rollup.status
      : task.value?.status
  return isPlannedDueOverdue(dueDate, st)
}

async function handleDelete() {
  if (!task.value) return
  await tasksStore.deleteTask(task.value.taskId)
  showDeleteConfirm.value = false
  modelValue.value = false
}

async function commitCompletion(value: number) {
  if (!task.value || isParentTask(task.value, tasksStore.activeTasks)) return
  const next = normalizeCompletion(value)
  localCompletion.value = next
  if (next === normalizeCompletion(task.value.completionPercent)) return

  // 0→未着手 / 1〜99→進行中 / 100→完了
  // レビュー待ち・保留は完了度を変えてもステータス維持
  const nextStatus = resolveStatusAfterCompletionChange(next, task.value.status)

  if (nextStatus === '完了') {
    const block = completeBlockMessage(task.value)
    if (block) {
      localCompletion.value = normalizeCompletion(task.value.completionPercent)
      uiStore.showError(block)
      return
    }
  }

  isSavingProgress.value = true
  try {
    await tasksStore.updateTask(task.value.taskId, {
      completionPercent: next,
      ...(nextStatus !== task.value.status ? { status: nextStatus } : {}),
    })
  } catch (e: unknown) {
    localCompletion.value = normalizeCompletion(task.value.completionPercent)
    const msg =
      e && typeof e === 'object' && 'response' in e
        ? // axios-style
          String(
            (e as { response?: { data?: { error?: { message?: string } } } })
              .response?.data?.error?.message || '進捗の更新に失敗しました',
          )
        : '進捗の更新に失敗しました'
    uiStore.showError(msg)
  } finally {
    isSavingProgress.value = false
  }
}

async function persistDeliverable(
  patch: {
    deliverableEnabled?: boolean
    deliverableChecklist?: DeliverableCheckItem[]
  },
): Promise<boolean> {
  if (!task.value || isParent.value) return false
  isSavingDeliverable.value = true
  try {
    await tasksStore.updateTask(task.value.taskId, patch)
    return true
  } catch (e: unknown) {
    const msg =
      e && typeof e === 'object' && 'response' in e
        ? String(
            (e as { response?: { data?: { error?: { message?: string } } } })
              .response?.data?.error?.message || '成果物の更新に失敗しました',
          )
        : '成果物の更新に失敗しました'
    uiStore.showError(msg)
    await tasksStore.fetchTask(task.value.taskId)
    return false
  } finally {
    isSavingDeliverable.value = false
  }
}

async function onToggleDeliverableEnabled(enabled: boolean | null) {
  if (!task.value || enabled == null) return
  const checklist =
    enabled && !(task.value.deliverableChecklist?.length)
      ? [newCheckItem('成果物を確認した')]
      : task.value.deliverableChecklist
  await persistDeliverable({
    deliverableEnabled: enabled,
    ...(enabled && checklist ? { deliverableChecklist: checklist } : {}),
  })
}

async function onToggleCheckItem(item: DeliverableCheckItem, done: boolean | null) {
  if (!task.value || done == null) return
  const list = [...(task.value.deliverableChecklist ?? [])]
  const idx = list.findIndex((i) => i.itemId === item.itemId)
  if (idx < 0) return
  const uid = authStore.currentUser?.sub
  list[idx] = {
    ...list[idx]!,
    done,
    doneAt: done ? new Date().toISOString() : undefined,
    doneBy: done ? uid : undefined,
  }
  await persistDeliverable({ deliverableChecklist: list })
}

async function onAddCheckItem() {
  if (!task.value) return
  const list = [...(task.value.deliverableChecklist ?? [])]
  const item = newCheckItem()
  item.sortOrder = list.length
  list.push(item)
  await persistDeliverable({
    deliverableEnabled: true,
    deliverableChecklist: list,
  })
}

async function onRemoveCheckItem(itemId: string) {
  if (!task.value) return
  const list = (task.value.deliverableChecklist ?? []).filter(
    (i) => i.itemId !== itemId,
  )
  await persistDeliverable({ deliverableChecklist: list })
}

async function onRenameCheckItem(item: DeliverableCheckItem, title: string) {
  if (!task.value) return
  const t = title.trim()
  if (!t || t === item.title) return
  const list = (task.value.deliverableChecklist ?? []).map((i) =>
    i.itemId === item.itemId ? { ...i, title: t } : i,
  )
  await persistDeliverable({ deliverableChecklist: list })
}

async function onToggleRequired(item: DeliverableCheckItem, required: boolean | null) {
  if (!task.value || required == null) return
  const list = (task.value.deliverableChecklist ?? []).map((i) =>
    i.itemId === item.itemId ? { ...i, required } : i,
  )
  await persistDeliverable({ deliverableChecklist: list })
}

function onPickUploadFile(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files
  if (!file) {
    pendingUploadFile.value = null
    return
  }
  const MAX_SIZE = 50 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    uiStore.showError('ファイルサイズが上限（50MB）を超えています')
    pendingUploadFile.value = null
    return
  }
  pendingUploadFile.value = file
}

function clearPendingUpload() {
  pendingUploadFile.value = null
}

async function confirmUploadPending() {
  const file = pendingUploadFile.value
  if (!task.value || !file) return

  isUploading.value = true
  try {
    const { uploadUrl } = await getUploadUrl(task.value.taskId, {
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      kind: uploadAsDeliverable.value ? 'deliverable' : 'general',
    })
    await axios.put(uploadUrl, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    })
    uiStore.showSuccess(
      uploadAsDeliverable.value
        ? '成果物をアップロードしました'
        : 'ファイルをアップロードしました',
    )
    pendingUploadFile.value = null
    await tasksStore.fetchTask(task.value.taskId)
  } catch {
    uiStore.showError('ファイルのアップロードに失敗しました')
  } finally {
    isUploading.value = false
  }
}

async function handleDownload(attachmentId: string, ownerTaskId?: string) {
  const tid = ownerTaskId || task.value?.taskId
  if (!tid) return
  try {
    const downloadUrl = await getDownloadUrl(tid, attachmentId)
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

/** パンくず / 子一覧から別タスクを開く */
async function openSibling(t: { taskId: string }) {
  const full = tasksStore.activeTasks.find((x) => x.taskId === t.taskId)
  if (full) {
    tasksStore.currentTask = full
  }
  try {
    await tasksStore.fetchTask(t.taskId)
  } catch {
    // 既にキャッシュを表示済みならそのまま
  }
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
        <div class="d-flex align-start px-5 pt-4 pb-2 ga-2">
          <div class="flex-grow-1 min-w-0">
            <p class="text-caption text-medium-emphasis mb-0 detail-kicker">
              タスク詳細
              <template v-if="task.wbsCode">
                · WBS {{ task.wbsCode }}
              </template>
            </p>
            <div
              v-if="crumbs.length > 1"
              class="detail-breadcrumb text-caption text-medium-emphasis mt-1"
            >
              <template v-for="(c, i) in crumbs" :key="c.taskId">
                <span v-if="i > 0" class="mx-1">/</span>
                <button
                  v-if="i < crumbs.length - 1"
                  type="button"
                  class="crumb-link"
                  @click="openSibling(c)"
                >
                  {{ c.wbsCode ? c.wbsCode + ' ' : '' }}{{ c.title }}
                </button>
                <span v-else class="font-weight-medium text-high-emphasis">
                  {{ c.wbsCode ? c.wbsCode + ' ' : '' }}{{ c.title }}
                </span>
              </template>
            </div>
          </div>
          <div class="detail-timestamps flex-shrink-0 text-right">
            <div class="detail-ts-line">
              <span class="detail-ts-label">作成</span>
              <span class="detail-ts-val">{{ formatDateTime(task.createdAt) }}</span>
            </div>
            <div class="detail-ts-line">
              <span class="detail-ts-label">更新</span>
              <span class="detail-ts-val">{{ formatDateTime(task.updatedAt) }}</span>
            </div>
          </div>
          <v-btn
            icon="mdi-pencil-outline"
            variant="tonal"
            color="primary"
            size="small"
            class="ml-1"
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
              v-if="plannedDue"
              size="default"
              label
              :color="isOverdue(plannedDue) ? 'error' : 'default'"
              :variant="isOverdue(plannedDue) ? 'flat' : 'tonal'"
              prepend-icon="mdi-calendar"
            >
              予定終了 {{ formatDate(plannedDue) }}
              <span v-if="isOverdue(plannedDue)" class="ml-1">（超過）</span>
            </v-chip>
          </div>
        </div>
      </div>

      <div class="task-detail-body flex-grow-1">
        <!-- 要件（ハイライト） -->
        <section class="detail-section mx-5 mt-4 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-bullseye-arrow</v-icon>
            要件
          </div>
          <div v-if="task.requirement?.trim()" class="requirement-card">
            <p class="requirement-text ma-0">{{ task.requirement }}</p>
          </div>
          <div v-else class="empty-block">
            未入力（編集画面から入力できます）
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
            未入力（編集画面から入力できます）
          </div>
        </section>

        <!-- 進捗（親は集計・編集不可） -->
        <section class="detail-section completion-section mx-5 mb-4">
          <div class="completion-row">
            <div class="section-label completion-label mb-0">
              <v-icon size="16" class="mr-1" color="primary">mdi-progress-check</v-icon>
              進捗
              <span v-if="isParent" class="text-caption font-weight-regular ml-1">（集計）</span>
            </div>
            <v-slider
              v-model="localCompletion"
              :min="0"
              :max="100"
              :step="5"
              :color="completionColor(localCompletion)"
              :disabled="isSavingProgress || isParent"
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
              :disabled="isSavingProgress || isParent"
              @change="commitCompletion(localCompletion)"
            />
            <v-btn
              v-if="!isParent"
              size="small"
              variant="tonal"
              color="primary"
              :loading="isSavingProgress"
              class="completion-btn"
              @click="commitCompletion(localCompletion)"
            >
              更新
            </v-btn>
          </div>
        </section>

        <!-- 担当者（親は子孫の和集合） -->
        <section class="detail-section mx-5 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-account-multiple-outline</v-icon>
            担当者
            <span v-if="isParent" class="text-caption font-weight-regular ml-1">
              （子の和集合）
            </span>
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
          <div v-else class="empty-block">未設定</div>
        </section>

        <!-- レビュアー（レビュー待ち / 完了で設定済みなら保持表示） -->
        <section v-if="showReviewersSection" class="detail-section mx-5 mb-4">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-account-check-outline</v-icon>
            レビュアー
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
              未指定（編集画面からメンバーを選べます）
            </template>
            <template v-else>なし</template>
          </div>
        </section>

        <!--
          スケジュール（3 列 × 2 行・上下対応）:
          予定: 開始 | 終了 | 工数
          実績: 開始 | 終了 | 工数
          親は rollup 値を表示
        -->
        <section class="schedule-block mx-5 mb-5">
          <p v-if="schedule.isRollup" class="schedule-rollup-note mb-2">
            子タスクから集計した値です（直接編集はできません）
          </p>
          <div class="schedule-row schedule-row--planned">
            <div class="schedule-row-label">予定</div>
            <div class="schedule-cells">
              <div class="meta-item">
                <span class="meta-key">開始日</span>
                <span class="meta-val">{{ formatDate(plannedStart) }}</span>
              </div>
              <div class="meta-item">
                <span class="meta-key">終了日</span>
                <span
                  class="meta-val"
                  :class="{ 'text-error font-weight-bold': isOverdue(plannedDue) }"
                >
                  {{ formatDate(plannedDue) }}
                </span>
              </div>
              <div class="meta-item">
                <span class="meta-key">工数（人日）</span>
                <span class="meta-val">
                  <template v-if="schedule.estimatedEffortDays != null">
                    {{ schedule.estimatedEffortDays }} 人日
                  </template>
                  <template v-else>未設定</template>
                </span>
              </div>
            </div>
          </div>
          <div
            class="schedule-row schedule-row--actual"
            :class="{
              'schedule-row--actual-ok': actualEndTone === 'ok',
              'schedule-row--actual-late': actualEndTone === 'late',
            }"
          >
            <div class="schedule-row-label">実績</div>
            <div class="schedule-cells">
              <div
                class="meta-item"
                :class="actualToneClass(actualStartTone)"
                :title="
                  actualStartTone === 'ok'
                    ? '予定開始日と同じか早い'
                    : actualStartTone === 'late'
                      ? '予定開始日より遅い'
                      : undefined
                "
              >
                <span class="meta-key">開始日</span>
                <span class="meta-val">{{ formatDate(schedule.actualStartDate) }}</span>
              </div>
              <div
                class="meta-item"
                :class="actualToneClass(actualEndTone)"
                :title="
                  actualEndTone === 'ok'
                    ? '予定終了日と同じか早い'
                    : actualEndTone === 'late'
                      ? '予定終了日より遅い'
                      : undefined
                "
              >
                <span class="meta-key">終了日</span>
                <span class="meta-val">{{ formatDate(schedule.actualDueDate) }}</span>
              </div>
              <div
                class="meta-item"
                :class="actualToneClass(actualEffortTone)"
                :title="
                  actualEffortTone === 'ok'
                    ? '予定工数以内'
                    : actualEffortTone === 'late'
                      ? '予定工数を超過'
                      : undefined
                "
              >
                <span class="meta-key">工数（人日）</span>
                <span class="meta-val">
                  <template v-if="schedule.actualEffortDays != null">
                    {{ schedule.actualEffortDays }} 人日
                  </template>
                  <template v-else>未設定</template>
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 子タスク一覧 -->
        <section v-if="isParent" class="detail-section mx-5 mb-5">
          <div class="section-label">
            <v-icon size="18" class="mr-1">mdi-file-tree-outline</v-icon>
            子タスク（{{ childTasks.length }}）
          </div>
          <div class="child-list">
            <button
              v-for="c in childTasks"
              :key="c.taskId"
              type="button"
              class="child-row"
              @click="openSibling(c)"
            >
              <span class="child-wbs">{{ c.wbsCode || '—' }}</span>
              <span class="child-title">{{ c.title }}</span>
              <v-chip
                size="x-small"
                label
                :color="STATUS_COLORS[c.status]"
                variant="tonal"
              >
                {{ c.status }}
              </v-chip>
            </button>
          </div>
        </section>

        <v-divider class="mb-4 mx-5" />

        <!-- 成果物チェック（任意・葉のみ） -->
        <section v-if="!isParent" class="detail-section mx-5 mb-4">
          <div class="section-label mb-2 d-flex align-center flex-wrap ga-2">
            <span class="d-inline-flex align-center">
              <v-icon size="18" class="mr-1">mdi-clipboard-check-outline</v-icon>
              成果物チェック
            </span>
            <v-switch
              :model-value="Boolean(task.deliverableEnabled)"
              color="primary"
              density="compact"
              hide-details
              inset
              class="deliverable-switch"
              :disabled="isSavingDeliverable"
              label="このタスクで使う"
              @update:model-value="onToggleDeliverableEnabled"
            />
          </div>
          <p class="text-caption text-medium-emphasis mb-2">
            任意設定です。有効にすると必須項目の未チェック時に「完了」へ進めません（レビュー待ちは警告のみ）。
          </p>

          <template v-if="task.deliverableEnabled">
            <div
              v-if="task.deliverableChecklist?.length"
              class="checklist-box mb-2"
            >
              <div
                v-for="item in task.deliverableChecklist"
                :key="item.itemId"
                class="checklist-row"
              >
                <v-checkbox
                  :model-value="item.done"
                  color="primary"
                  density="compact"
                  hide-details
                  :disabled="isSavingDeliverable"
                  class="checklist-check"
                  @update:model-value="(v) => onToggleCheckItem(item, v)"
                />
                <v-text-field
                  :model-value="item.title"
                  density="compact"
                  variant="plain"
                  hide-details
                  class="checklist-title"
                  :class="{
                    'is-placeholder-title':
                      item.title.includes('クリックして編集'),
                  }"
                  :disabled="isSavingDeliverable"
                  placeholder="項目名を入力"
                  @focus="
                    (e: FocusEvent) => {
                      const el = e.target as HTMLInputElement
                      if (item.title.includes('クリックして編集')) {
                        el.select()
                      }
                    }
                  "
                  @blur="
                    (e: FocusEvent) =>
                      onRenameCheckItem(
                        item,
                        (e.target as HTMLInputElement)?.value ?? item.title,
                      )
                  "
                  @keydown.enter.prevent="
                    ($event.target as HTMLInputElement)?.blur()
                  "
                />
                <v-chip
                  size="x-small"
                  :color="item.required ? 'warning' : 'default'"
                  variant="tonal"
                  label
                  class="checklist-req"
                  :disabled="isSavingDeliverable"
                  @click="onToggleRequired(item, !item.required)"
                >
                  {{ item.required ? '必須' : '任意' }}
                </v-chip>
                <v-btn
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  density="compact"
                  :disabled="isSavingDeliverable"
                  @click="onRemoveCheckItem(item.itemId)"
                />
              </div>
            </div>
            <div v-else class="empty-block mb-2">チェック項目がありません</div>
            <v-btn
              size="small"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-plus"
              :loading="isSavingDeliverable"
              @click="onAddCheckItem"
            >
              項目を追加
            </v-btn>
          </template>
        </section>

        <v-divider class="mb-4 mx-5" />

        <!-- 親: 子孫の成果物ファイルのみ（チェックリストは出さない） -->
        <section v-if="isParent" class="detail-section mx-5 mb-4">
          <div class="section-label mb-2">
            <v-icon size="18" class="mr-1">mdi-package-variant-closed-check</v-icon>
            子の成果物ファイル（{{ descendantDeliverables.length }} 件）
          </div>
          <p class="text-caption text-medium-emphasis mb-2">
            子孫タスクで「成果物として提出」されたファイルのみ表示します（通常添付・チェックリストは含みません）。
          </p>
          <div
            v-if="descendantDeliverables.length"
            class="attachment-list mb-1"
          >
            <div
              v-for="{ attachment, source } in descendantDeliverables"
              :key="`${source.taskId}-${attachment.attachmentId}`"
              class="attachment-row is-deliverable"
            >
              <v-icon
                size="18"
                class="mr-2 flex-shrink-0"
                color="primary"
              >
                mdi-package-variant-closed-check
              </v-icon>
              <div class="attachment-meta flex-grow-1 min-w-0">
                <span
                  class="text-body-2 text-primary text-truncate attachment-name d-block"
                  @click="
                    handleDownload(attachment.attachmentId, source.taskId)
                  "
                >
                  {{ attachment.filename }}
                </span>
                <span class="text-caption text-medium-emphasis">
                  {{ source.wbsCode ? `${source.wbsCode} · ` : ''
                  }}{{ source.title }}
                  · {{ formatFileSize(attachment.sizeBytes) }}
                </span>
              </div>
              <v-chip
                size="small"
                color="primary"
                variant="flat"
                label
                class="attachment-deliverable-badge flex-shrink-0"
                prepend-icon="mdi-check-decagram"
              >
                成果物
              </v-chip>
            </div>
          </div>
          <div v-else class="empty-block">
            子孫に成果物ファイルはまだありません
          </div>
        </section>

        <!-- 葉: 添付 / 成果物提出 -->
        <section v-else class="detail-section mx-5 mb-4">
          <div class="section-label mb-2">
            <v-icon size="18" class="mr-1">mdi-paperclip</v-icon>
            添付 / 成果物提出（{{ task.attachments?.length ?? 0 }} 件）
          </div>

          <div v-if="task.attachments?.length" class="attachment-list mb-3">
            <div
              v-for="attachment in task.attachments"
              :key="attachment.attachmentId"
              class="attachment-row"
              :class="{
                'is-deliverable': attachment.kind === 'deliverable',
              }"
            >
              <v-icon
                size="18"
                class="mr-2 flex-shrink-0"
                :color="
                  attachment.kind === 'deliverable' ? 'primary' : undefined
                "
                :class="
                  attachment.kind === 'deliverable'
                    ? ''
                    : 'text-medium-emphasis'
                "
              >
                {{
                  attachment.kind === 'deliverable'
                    ? 'mdi-package-variant-closed-check'
                    : 'mdi-file-outline'
                }}
              </v-icon>
              <span
                class="text-body-2 text-primary flex-grow-1 text-truncate attachment-name"
                @click="handleDownload(attachment.attachmentId)"
              >
                {{ attachment.filename }}
              </span>
              <span class="text-caption text-medium-emphasis mr-2 flex-shrink-0">
                {{ formatFileSize(attachment.sizeBytes) }}
              </span>
              <v-chip
                v-if="attachment.kind === 'deliverable'"
                size="small"
                color="primary"
                variant="flat"
                label
                class="attachment-deliverable-badge flex-shrink-0 mr-1"
                prepend-icon="mdi-check-decagram"
              >
                成果物
              </v-chip>
              <v-btn
                icon="mdi-delete-outline"
                variant="text"
                size="x-small"
                color="error"
                density="compact"
                class="flex-shrink-0"
                @click="handleDeleteAttachment(attachment.attachmentId)"
              />
            </div>
          </div>

          <div class="upload-options mb-2">
            <v-checkbox
              v-model="uploadAsDeliverable"
              density="compact"
              hide-details
              color="primary"
              class="upload-deliverable-check"
            >
              <template #label>
                <span class="text-body-2">
                  成果物として提出
                  <span class="text-caption text-medium-emphasis">
                    （一覧右端に「成果物」バッジが付きます）
                  </span>
                </span>
              </template>
            </v-checkbox>
          </div>
          <v-file-input
            :model-value="pendingUploadFile"
            :label="
              uploadAsDeliverable
                ? '成果物ファイルを選択'
                : '添付ファイルを選択'
            "
            :prepend-icon="
              uploadAsDeliverable ? 'mdi-package-variant-closed' : 'mdi-upload'
            "
            hide-details
            density="compact"
            variant="outlined"
            clearable
            :color="uploadAsDeliverable ? 'primary' : undefined"
            :disabled="isUploading"
            show-size
            @update:model-value="onPickUploadFile"
            @click:clear="clearPendingUpload"
          />
          <div
            v-if="pendingUploadFile"
            class="upload-pending-bar d-flex align-center flex-wrap ga-2 mt-2"
          >
            <span class="text-caption text-medium-emphasis min-w-0 text-truncate">
              選択中:
              <strong class="text-high-emphasis">{{
                pendingUploadFile.name
              }}</strong>
              （{{ formatFileSize(pendingUploadFile.size) }}）
              · まだアップロードされていません
            </span>
            <v-spacer />
            <v-btn
              size="small"
              variant="text"
              rounded="lg"
              :disabled="isUploading"
              @click="clearPendingUpload"
            >
              クリア
            </v-btn>
            <v-btn
              size="small"
              color="primary"
              variant="flat"
              rounded="lg"
              prepend-icon="mdi-cloud-upload-outline"
              :loading="isUploading"
              @click="confirmUploadPending"
            >
              {{ uploadAsDeliverable ? '成果物をアップロード' : 'アップロード' }}
            </v-btn>
          </div>
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
    confirm-text="削除"
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
  /* 3 列スケジュールが窮屈にならないよう幅を広めに */
  width: min(860px, 100vw) !important;
  max-width: min(860px, 100vw) !important;
  align-self: stretch !important;
}

@media (min-width: 1400px) {
  .task-detail-dialog.v-overlay__content {
    width: min(920px, 52vw) !important;
    max-width: min(920px, 52vw) !important;
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

.detail-timestamps {
  padding-top: 2px;
  line-height: 1.35;
}

.detail-ts-line {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 6px;
  white-space: nowrap;
}

.detail-ts-label {
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}

.detail-ts-val {
  font-size: 0.78rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-variant-numeric: tabular-nums;
}

.detail-breadcrumb {
  line-height: 1.4;
  word-break: break-word;
}

.crumb-link {
  border: none;
  background: none;
  padding: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.crumb-link:hover {
  text-decoration: underline;
}

.schedule-rollup-note {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.child-list {
  border-radius: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  overflow: hidden;
}

.child-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
}

.child-row:last-child {
  border-bottom: none;
}

.child-row:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.child-wbs {
  flex: 0 0 auto;
  min-width: 2.5rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-variant-numeric: tabular-nums;
}

.child-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.deliverable-switch {
  margin-inline-start: auto;
  flex: 0 0 auto;
}
.deliverable-switch :deep(.v-label) {
  font-size: 0.75rem;
  text-transform: none;
  letter-spacing: 0;
  opacity: 0.8;
}
.checklist-box {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 10px;
  padding: 4px 8px;
  background: rgba(var(--v-theme-on-surface), 0.02);
}
.checklist-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 40px;
}
.checklist-check {
  flex: 0 0 auto;
  margin-inline-end: 0;
}
.checklist-title {
  flex: 1 1 auto;
  min-width: 0;
}
.checklist-title :deep(input) {
  font-size: 0.9rem;
  font-weight: 600;
}
.checklist-req {
  flex: 0 0 auto;
  cursor: pointer;
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

.schedule-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.schedule-row {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 10px;
  align-items: stretch;
}

.schedule-row-label {
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: horizontal-tb;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  border-radius: 10px;
  padding: 8px 4px;
  text-align: center;
  line-height: 1.2;
}

.schedule-row--planned .schedule-row-label {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}

.schedule-row--actual .schedule-row-label {
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: rgba(var(--v-theme-on-surface), 0.06);
}

/* 実績ラベルは終了日の判定に合わせる */
.schedule-row--actual-ok .schedule-row-label {
  color: #1b5e20;
  background: rgba(46, 125, 50, 0.16);
}

.schedule-row--actual-late .schedule-row-label {
  color: #b71c1c;
  background: rgba(198, 40, 40, 0.14);
}

.schedule-cells {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;
}

.meta-item {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  min-width: 0;
}

.schedule-row--planned .meta-item {
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px solid rgba(var(--v-theme-primary), 0.1);
}

.schedule-row--actual .meta-item {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* 実績が予定どおり or 早い / 工数以内 */
.schedule-row--actual .meta-item--ok {
  background: rgba(46, 125, 50, 0.12);
  border-color: rgba(46, 125, 50, 0.28);
}

/* 実績が予定より遅い / 工数超過 */
.schedule-row--actual .meta-item--late {
  background: rgba(198, 40, 40, 0.1);
  border-color: rgba(198, 40, 40, 0.28);
}

.meta-key {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.48);
  margin-bottom: 6px;
}

.meta-val {
  font-size: 0.98rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
  line-height: 1.35;
}

@media (max-width: 560px) {
  .schedule-row {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .schedule-row-label {
    justify-content: flex-start;
    padding: 6px 10px;
    width: fit-content;
  }

  .schedule-cells {
    grid-template-columns: 1fr;
  }
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
  gap: 4px;
}

.attachment-row:last-child {
  border-bottom: none;
}

.attachment-row.is-deliverable {
  background: rgba(var(--v-theme-primary), 0.06);
  border-left: 3px solid rgb(var(--v-theme-primary));
}

.attachment-deliverable-badge {
  font-weight: 800;
  letter-spacing: 0.02em;
}

.attachment-name {
  cursor: pointer;
  min-width: 0;
}

.attachment-name:hover {
  text-decoration: underline;
}

.attachment-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.upload-pending-bar {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.05);
  border: 1px dashed rgba(var(--v-theme-primary), 0.25);
}

.checklist-title.is-placeholder-title :deep(input) {
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-style: italic;
  font-weight: 500;
}

.min-w-0 {
  min-width: 0;
}
</style>
