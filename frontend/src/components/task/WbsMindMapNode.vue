<script setup lang="ts">
/**
 * WBS マインドマップの 1 ノード（再帰）
 * 詳細ビュー専用。DnD なし（構造編集は「構成ツリー」モードへ）。
 * 字下げ/字上げ・子/同階追加はカード操作で行う。
 */
import { computed } from 'vue'

defineOptions({ name: 'WbsMindMapNode' })
import type { Task } from '@/types/task'
import {
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  normalizeCompletion,
} from '@/types/task'
import {
  canAddChild,
  childrenOf,
  displaySchedule,
  hasChildren,
} from '@/utils/wbs'
import {
  avatarLabelFromName,
  resolveAssigneeLabels,
} from '@/utils/displayName'

const props = defineProps<{
  task: Task
  allTasks: Task[]
  depth: number
  expandedIds: Set<string>
  busy?: boolean
}>()

const emit = defineEmits<{
  open: [task: Task]
  toggle: [taskId: string]
  'add-child': [parent: Task]
  'add-sibling': [task: Task]
}>()

const kids = computed(() =>
  childrenOf(props.allTasks, props.task.taskId, 'asc', 'wbs'),
)
const isParent = computed(() => hasChildren(props.task, props.allTasks))
const expanded = computed(() => props.expandedIds.has(props.task.taskId))
const sched = computed(() => displaySchedule(props.task))
const progress = computed(() =>
  normalizeCompletion(
    sched.value.isRollup
      ? sched.value.completionPercent
      : props.task.completionPercent,
  ),
)
const statusColor = computed(
  () => STATUS_COLORS[props.task.status] || 'grey',
)
const depthClass = computed(() => {
  if (props.depth <= 0) return 'depth-0'
  if (props.depth === 1) return 'depth-1'
  return 'depth-2'
})

const allowChild = computed(() => canAddChild(props.task, props.allTasks))

const assigneeLabels = computed(() => {
  if (isParent.value && props.task.rollup?.assignees?.length) {
    return props.task.rollup.assignees.map(
      (a) => a.displayName?.trim() || a.userId,
    )
  }
  return resolveAssigneeLabels(props.task)
})

const assigneePrimary = computed(() => assigneeLabels.value[0] || '')
const assigneeExtra = computed(() =>
  Math.max(0, assigneeLabels.value.length - 1),
)
const assigneeAvatar = computed(() =>
  avatarLabelFromName(assigneePrimary.value),
)

const childCount = computed(
  () => props.task.childCount ?? kids.value.length,
)
const doneChildCount = computed(
  () => kids.value.filter((k) => k.status === '完了').length,
)

const showPriority = computed(() => {
  if (!isParent.value) return true
  return props.task.priority === 'high' || props.task.priority === 'urgent'
})

function shortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  if (d.length < 10) return d
  return `${d.slice(5, 7)}/${d.slice(8, 10)}`
}

const dateRangeText = computed(() => {
  const s = shortDate(sched.value.plannedStartDate)
  const e = shortDate(sched.value.plannedDueDate)
  if (s && e) return `${s}→${e}`
  if (s) return `${s}→`
  if (e) return `→${e}`
  return ''
})

const effortText = computed(() => {
  const est = sched.value.estimatedEffortDays
  const act = sched.value.actualEffortDays
  const parts: string[] = []
  if (est != null) parts.push(`予${est}`)
  if (act != null) parts.push(`実${act}`)
  return parts.join(' ')
})

const commentCount = computed(() => props.task.commentCount ?? 0)

function onCardClick(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (t.closest('.mm-expand') || t.closest('.mm-actions')) {
    return
  }
  emit('open', props.task)
}

function onToggle(e: Event) {
  e.stopPropagation()
  emit('toggle', props.task.taskId)
}

function stop(e: Event) {
  e.stopPropagation()
}
</script>

<template>
  <div
    class="mm-unit"
    :class="[depthClass, isParent ? 'is-parent-unit' : 'is-leaf-unit']"
  >
    <div class="mm-node-row">
      <div
        class="mm-card"
        :class="{ 'is-parent': isParent, 'is-leaf': !isParent }"
        role="button"
        tabindex="0"
        @click="onCardClick"
        @keydown.enter="emit('open', task)"
      >
        <div class="mm-card-body">
          <div class="mm-card-top">
            <button
              v-if="isParent"
              type="button"
              class="mm-expand"
              :aria-expanded="expanded"
              :title="expanded ? '折りたたむ' : '展開'"
              @click="onToggle"
            >
              <v-icon size="16">
                {{ expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}
              </v-icon>
            </button>
            <span v-else class="mm-leaf-dot" title="葉タスク" />
            <span v-if="task.wbsCode" class="mm-wbs">{{ task.wbsCode }}</span>
            <v-spacer />
            <v-chip
              v-if="showPriority"
              :color="PRIORITY_COLORS[task.priority]"
              size="x-small"
              label
              variant="tonal"
              class="mm-chip"
            >
              {{ PRIORITY_LABELS[task.priority] }}
            </v-chip>
            <v-chip
              :color="statusColor"
              size="x-small"
              label
              variant="tonal"
              class="mm-chip"
            >
              {{ task.status }}
            </v-chip>
          </div>

          <div
            class="mm-title"
            :class="{ 'is-leaf-title': !isParent }"
            :title="task.title"
          >
            {{ task.title }}
          </div>

          <div class="mm-meta-row">
            <span
              v-if="assigneePrimary"
              class="mm-assignee"
              :title="assigneeLabels.join('、')"
            >
              <span class="mm-avatar">{{ assigneeAvatar }}</span>
              <span class="mm-assignee-name">
                {{ assigneePrimary }}
                <template v-if="assigneeExtra > 0">+{{ assigneeExtra }}</template>
              </span>
            </span>
            <span v-else class="mm-assignee is-empty">未担当</span>

            <span
              v-if="isParent"
              class="mm-child-stat"
              :title="`子 ${childCount} · 完了 ${doneChildCount}`"
            >
              <v-icon size="12">mdi-file-tree-outline</v-icon>
              {{ childCount }}
              <span class="mm-muted">/{{ doneChildCount }}完</span>
            </span>
            <span v-else-if="commentCount > 0" class="mm-comment">
              <v-icon size="12">mdi-comment-outline</v-icon>
              {{ commentCount }}
            </span>

            <span class="mm-flex-gap" />

            <span
              class="mm-dates"
              :class="{ 'is-empty': !dateRangeText }"
              :title="dateRangeText || '日程未設定'"
            >
              <v-icon size="12">mdi-calendar-range</v-icon>
              {{ dateRangeText || '—' }}
            </span>
            <span class="mm-effort" :class="{ 'is-empty': !effortText }">
              {{ effortText || '工数—' }}
            </span>
          </div>

          <div class="mm-progress-row">
            <v-progress-linear
              :model-value="progress"
              :color="statusColor"
              height="4"
              rounded
              class="mm-progress-bar"
            />
            <span class="mm-prog">{{ progress }}%</span>
          </div>
        </div>

        <div class="mm-actions" @click="stop">
          <button
            type="button"
            class="mm-act"
            title="子タスクを追加"
            :disabled="busy || !allowChild"
            @click="emit('add-child', task)"
          >
            <v-icon size="14">mdi-plus</v-icon>
            <span>子</span>
          </button>
          <button
            type="button"
            class="mm-act"
            title="同じ階層に追加"
            :disabled="busy"
            @click="emit('add-sibling', task)"
          >
            <v-icon size="14">mdi-plus-box-outline</v-icon>
            <span>同階</span>
          </button>
        </div>
      </div>

      <div v-if="isParent && expanded && kids.length" class="mm-branch">
        <div class="mm-connector-h" aria-hidden="true" />
        <div class="mm-children">
          <div
            v-for="(child, index) in kids"
            :key="child.taskId"
            class="mm-child-wrap"
            :class="{
              'is-first': index === 0,
              'is-last': index === kids.length - 1,
              'is-only': kids.length === 1,
            }"
          >
            <WbsMindMapNode
              :task="child"
              :all-tasks="allTasks"
              :depth="depth + 1"
              :expanded-ids="expandedIds"
              :busy="busy"
              @open="emit('open', $event)"
              @toggle="emit('toggle', $event)"
              @add-child="emit('add-child', $event)"
              @add-sibling="emit('add-sibling', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-unit {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex-shrink: 0;
}

.mm-node-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.mm-card {
  width: var(--mm-card-w, 280px);
  min-width: var(--mm-card-w, 280px);
  max-width: var(--mm-card-w, 280px);
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  border: 1.5px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition:
    box-shadow 0.15s ease,
    border-color 0.15s ease;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
}
.mm-card.is-leaf {
  height: var(--mm-leaf-h, 93px);
  min-height: var(--mm-leaf-h, 93px);
  max-height: var(--mm-leaf-h, 93px);
  aspect-ratio: 3 / 1;
  overflow: hidden;
  border-left: 3px solid rgba(var(--v-theme-primary), 0.3);
  justify-content: space-between;
}
.mm-card.is-parent {
  height: auto;
  min-height: var(--mm-leaf-h, 93px);
  border-width: 2px;
  border-color: rgba(var(--v-theme-primary), 0.32);
  padding-bottom: 6px;
}
.depth-0 > .mm-node-row > .mm-card {
  background: linear-gradient(
    145deg,
    rgba(var(--v-theme-primary), 0.08),
    rgb(var(--v-theme-surface)) 55%
  );
}
.mm-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  box-shadow: 0 3px 12px rgba(var(--v-theme-primary), 0.1);
}

.mm-card-body {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  overflow: hidden;
}

.mm-card-top {
  display: flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
}
.mm-expand {
  flex-shrink: 0;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border: none;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 5px;
  padding: 0;
  cursor: pointer;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.mm-expand:hover {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.mm-leaf-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin: 0 4px;
  flex-shrink: 0;
  background: rgba(var(--v-theme-primary), 0.5);
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.12);
}
.mm-wbs {
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-primary));
  flex-shrink: 0;
}
.mm-chip {
  flex-shrink: 0;
  height: 18px !important;
  font-size: 0.62rem !important;
}

.mm-title {
  font-size: 0.86rem;
  font-weight: 700;
  line-height: 1.25;
  color: rgba(var(--v-theme-on-surface), 0.92);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mm-title.is-leaf-title {
  -webkit-line-clamp: 1;
  display: block;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}

.mm-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.66rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.mm-assignee {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: 0;
  max-width: 34%;
}
.mm-avatar {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.52rem;
  font-weight: 800;
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
}
.mm-assignee-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-assignee.is-empty,
.mm-dates.is-empty,
.mm-effort.is-empty {
  color: rgba(var(--v-theme-on-surface), 0.36);
  font-weight: 500;
}
.mm-child-stat,
.mm-comment,
.mm-dates,
.mm-effort {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  white-space: nowrap;
}
.mm-muted {
  color: rgba(var(--v-theme-on-surface), 0.42);
  font-weight: 500;
}
.mm-flex-gap {
  flex: 1;
  min-width: 4px;
}
.mm-dates {
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mm-progress-bar {
  flex: 1;
  min-width: 0;
}
.mm-prog {
  flex-shrink: 0;
  font-size: 0.66rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.68);
  min-width: 2.2em;
  text-align: right;
}

.mm-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 3px;
  flex-shrink: 0;
}
.mm-card.is-parent .mm-actions {
  margin-top: 6px;
  padding-top: 5px;
  border-top: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity));
}
.mm-card.is-leaf .mm-actions {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: 4px 8px;
  border-top: none;
  background: linear-gradient(
    to top,
    rgba(var(--v-theme-surface), 0.98) 60%,
    rgba(var(--v-theme-surface), 0.85)
  );
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  z-index: 3;
}
.mm-card.is-leaf:hover .mm-actions,
.mm-card.is-leaf:focus-within .mm-actions {
  opacity: 1;
  pointer-events: auto;
}
.mm-act {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 20px;
  padding: 0 5px;
  border: none;
  border-radius: 5px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.6rem;
  font-weight: 700;
  cursor: pointer;
}
.mm-act:hover:not(:disabled) {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.mm-act:disabled {
  opacity: 0.32;
  cursor: not-allowed;
}

.mm-branch {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex-shrink: 0;
}
.mm-connector-h {
  width: var(--mm-link, 28px);
  flex-shrink: 0;
  align-self: center;
  height: 0;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.35);
  box-sizing: border-box;
}
.mm-children {
  display: flex;
  flex-direction: column;
  gap: var(--mm-sibling-gap, 16px);
  position: relative;
  flex-shrink: 0;
}
.mm-child-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  position: relative;
  padding-left: var(--mm-rail, 22px);
  box-sizing: border-box;
  flex-shrink: 0;
}
.mm-child-wrap::before {
  content: '';
  position: absolute;
  left: 0;
  border-left: 2px solid rgba(var(--v-theme-primary), 0.32);
  top: calc(var(--mm-sibling-gap, 16px) / -2);
  bottom: calc(var(--mm-sibling-gap, 16px) / -2);
}
.mm-child-wrap.is-first::before {
  top: 50%;
}
.mm-child-wrap.is-last::before {
  bottom: 50%;
}
.mm-child-wrap.is-only::before {
  display: none;
}
.mm-child-wrap::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: var(--mm-rail, 22px);
  border-top: 2px solid rgba(var(--v-theme-primary), 0.32);
}
</style>
