<script setup lang="ts">
// かんばんタスクカード
// - 左のドラッグハンドルでのみ移動（Sortable がカード本体の click を奪わない）
// - カード本体クリックで詳細を開く
// - 複数担当はアバター重なりで表示（名前の切り詰めを避ける）
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { Task } from '@/types/task'
import {
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  normalizeCompletion,
  completionColor,
  getPlannedStartDate,
  getPlannedDueDate,
  isPlannedDueOverdue,
  isPlannedDueSoon,
} from '@/types/task'
import { displaySchedule } from '@/utils/wbs'
import {
  resolveAssigneeLabels,
  resolveReviewerLabels,
  avatarLabelFromName,
} from '@/utils/displayName'
import { useDisplayNamesStore } from '@/stores/displayNames'

const props = defineProps<{
  task: Task
  /** ログインユーザーが評価者のレビュー待ち（強調表示） */
  needsMyReview?: boolean
}>()

const emit = defineEmits<{
  open: [task: Task]
}>()

const displayNamesStore = useDisplayNamesStore()
const { byUserId, byEmail } = storeToRefs(displayNamesStore)

/** 表示するアバター最大数（超過分は +N） */
const MAX_VISIBLE_AVATARS = 3

const assigneeLabels = computed(() => {
  void byUserId.value
  void byEmail.value
  return resolveAssigneeLabels(props.task)
})

const visibleAssignees = computed(() =>
  assigneeLabels.value.slice(0, MAX_VISIBLE_AVATARS),
)

const overflowCount = computed(() =>
  Math.max(0, assigneeLabels.value.length - MAX_VISIBLE_AVATARS),
)

const assigneeTitle = computed(() => assigneeLabels.value.join('、'))

const primaryAssigneeName = computed(() => assigneeLabels.value[0] ?? '')

const reviewerLabels = computed(() => {
  void byUserId.value
  void byEmail.value
  return resolveReviewerLabels(props.task)
})

const schedule = computed(() => displaySchedule(props.task))

/** 親は rollup 日程、葉は自身（displaySchedule 経由） */
const plannedStart = computed(
  () => schedule.value.plannedStartDate || getPlannedStartDate(props.task),
)
const plannedDue = computed(
  () => schedule.value.plannedDueDate || getPlannedDueDate(props.task),
)

/** 構成マインドマップと同じ MM/DD */
function shortMd(iso?: string | null): string {
  if (!iso) return ''
  // YYYY-MM-DD を優先（タイムゾーンずれを避ける）
  const raw = iso.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw.slice(5, 7)}/${raw.slice(8, 10)}`
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${m}/${day}`
}

/** 予定期間: 07/22→07/28（片方だけでも可） */
const plannedRangeText = computed(() => {
  const s = shortMd(plannedStart.value)
  const e = shortMd(plannedDue.value)
  if (s && e) return `${s}→${e}`
  if (s) return `${s}→`
  if (e) return `→${e}`
  return ''
})

const plannedRangeTitle = computed(() => {
  const s = shortMd(plannedStart.value)
  const e = shortMd(plannedDue.value)
  if (s && e) return `予定 ${s} → ${e}`
  if (s) return `予定開始 ${s}`
  if (e) return `予定終了 ${e}`
  return '日程未設定'
})

function isOverdue(dueDate?: string): boolean {
  return isPlannedDueOverdue(dueDate, props.task.status)
}

function isDueSoon(dueDate?: string): boolean {
  return isPlannedDueSoon(dueDate, props.task.status)
}

/** 親は rollup 加重進捗を表示 */
function progress(task: Task): number {
  return normalizeCompletion(displaySchedule(task).completionPercent)
}

/** 予/実 工数（構成ビューと同じ略記） */
const effortHint = computed(() => {
  const est = schedule.value.estimatedEffortDays
  const act = schedule.value.actualEffortDays
  const parts: string[] = []
  if (est != null) parts.push(`予${est}`)
  if (act != null) parts.push(`実${act}`)
  return parts.join(' ')
})

/** アバターは姓のみ（フルネームから姓を抽出） */
function avatarText(fullName: string): string {
  return avatarLabelFromName(fullName) || '?'
}

/** 担当者ごとに安定した色（見た目の区別用） */
const AVATAR_COLORS = ['primary', 'teal', 'indigo', 'deep-orange', 'purple'] as const
function avatarColor(index: number): string {
  return AVATAR_COLORS[index % AVATAR_COLORS.length] ?? 'primary'
}

function onBodyClick() {
  emit('open', props.task)
}
</script>

<template>
  <div class="task-card-root">
    <button
      type="button"
      class="drag-handle"
      title="ドラッグして移動"
      aria-label="ドラッグして移動"
      @click.stop
    >
      <v-icon size="18" color="medium-emphasis">mdi-drag-vertical</v-icon>
    </button>

    <v-card
      rounded="lg"
      elevation="1"
      class="task-card"
      :class="{ 'task-card--my-review': needsMyReview }"
      role="button"
      tabindex="0"
      @click="onBodyClick"
      @keydown.enter.prevent="onBodyClick"
      @keydown.space.prevent="onBodyClick"
    >
      <v-card-text class="pa-3">
        <div
          v-if="needsMyReview"
          class="my-review-banner text-caption font-weight-bold mb-2"
        >
          <v-icon size="14" class="mr-1">mdi-clipboard-check-outline</v-icon>
          レビュー依頼
        </div>
        <p class="text-body-2 font-weight-medium mb-1 task-title">
          <span
            v-if="task.wbsCode"
            class="task-wbs text-caption font-weight-bold text-medium-emphasis mr-1"
          >{{ task.wbsCode }}</span>{{ task.title }}
        </p>

        <div v-if="task.requirement" class="mb-2">
          <span class="text-caption text-medium-emphasis d-block mb-0">要件</span>
          <p class="text-body-2 text-medium-emphasis ma-0 task-requirement">
            {{ task.requirement }}
          </p>
        </div>

        <!-- 進捗バー -->
        <div v-if="progress(task) > 0 || task.status === '進行中'" class="mb-2">
          <div class="d-flex align-center justify-space-between mb-0">
            <span class="text-caption text-medium-emphasis">進捗</span>
            <span
              class="text-caption font-weight-bold"
              :class="`text-${completionColor(progress(task))}`"
            >
              {{ progress(task) }}%
            </span>
          </div>
          <v-progress-linear
            :model-value="progress(task)"
            :color="completionColor(progress(task))"
            height="4"
            rounded
          />
        </div>

        <!-- メタ行: 優先度・コメント・予定終了日 -->
        <div class="d-flex align-center flex-wrap gap-1 mt-2">
          <v-chip
            :color="PRIORITY_COLORS[task.priority]"
            size="x-small"
            label
            variant="tonal"
          >
            {{ PRIORITY_LABELS[task.priority] }}
          </v-chip>

          <v-chip
            v-if="task.commentCount && task.commentCount > 0"
            size="x-small"
            variant="text"
            prepend-icon="mdi-comment-outline"
            class="text-medium-emphasis"
          >
            {{ task.commentCount }}
          </v-chip>

          <v-chip
            v-if="
              (task.status === 'レビュー待ち' || task.status === '完了') &&
              reviewerLabels.length
            "
            size="x-small"
            color="warning"
            variant="tonal"
            prepend-icon="mdi-account-check-outline"
            :title="reviewerLabels.join('、')"
          >
            レビュー {{ reviewerLabels.length }}
          </v-chip>

          <v-spacer />

          <!-- 予定期間: 構成ビューと同じ 07/22→07/28 -->
          <span
            v-if="plannedRangeText"
            class="text-caption planned-range"
            :title="plannedRangeTitle"
            :class="{
              'text-error font-weight-bold': isOverdue(plannedDue),
              'text-warning font-weight-bold':
                isDueSoon(plannedDue) && !isOverdue(plannedDue),
              'text-medium-emphasis':
                !isOverdue(plannedDue) && !isDueSoon(plannedDue),
            }"
          >
            <v-icon size="12" class="mr-1">mdi-calendar-range</v-icon>
            {{ plannedRangeText }}
            <template v-if="effortHint">
              <span class="planned-effort"> · {{ effortHint }}</span>
            </template>
          </span>
        </div>

        <!-- 担当者行: 複数はアバター重なり、1人はアバター+名前 -->
        <div
          v-if="assigneeLabels.length > 0"
          class="assignee-row mt-2"
          :title="assigneeTitle"
        >
          <div class="avatar-stack" aria-hidden="true">
            <v-avatar
              v-for="(name, idx) in visibleAssignees"
              :key="`${name}-${idx}`"
              size="22"
              :color="avatarColor(idx)"
              class="stack-avatar"
              :style="{ zIndex: visibleAssignees.length - idx }"
            >
              <span class="avatar-initials">{{ avatarText(name) }}</span>
            </v-avatar>
            <v-avatar
              v-if="overflowCount > 0"
              size="22"
              color="grey-darken-1"
              class="stack-avatar stack-more"
              :style="{ zIndex: 0 }"
            >
              <span class="avatar-initials">+{{ overflowCount }}</span>
            </v-avatar>
          </div>

          <!-- 1人: 名前を併記 / 複数: 人数のみ（ホバーで全員名） -->
          <span
            v-if="assigneeLabels.length === 1"
            class="assignee-name text-caption text-medium-emphasis"
          >
            {{ primaryAssigneeName }}
          </span>
          <span
            v-else
            class="assignee-count text-caption text-medium-emphasis"
          >
            {{ assigneeLabels.length }} 名
          </span>
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.task-card-root {
  display: flex;
  align-items: stretch;
  gap: 2px;
}

.drag-handle {
  flex: 0 0 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: grab;
  border-radius: 6px;
  touch-action: none;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.task-card {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.1s ease, outline 0.15s ease;
}

.task-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12) !important;
  transform: translateY(-1px);
}

.task-card--my-review {
  outline: 2px solid rgb(var(--v-theme-warning));
  outline-offset: 0;
  background: rgba(var(--v-theme-warning), 0.06);
}

.my-review-banner {
  display: flex;
  align-items: center;
  color: rgb(var(--v-theme-warning));
  letter-spacing: 0.02em;
}

.task-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}

.task-wbs {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.planned-range {
  display: inline-flex;
  align-items: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  letter-spacing: 0.01em;
}
.planned-effort {
  font-weight: 600;
  opacity: 0.85;
}

.task-requirement {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  word-break: break-word;
}

.assignee-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.avatar-stack {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
}

.stack-avatar {
  margin-left: -6px;
  border: 1.5px solid rgb(var(--v-theme-surface));
  box-sizing: content-box;
}

.stack-avatar:first-child {
  margin-left: 0;
}

.avatar-initials {
  font-size: 9px;
  font-weight: 700;
  color: white;
  line-height: 1;
  letter-spacing: -0.02em;
}

.assignee-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignee-count {
  flex: 0 0 auto;
  white-space: nowrap;
  opacity: 0.85;
}
</style>
