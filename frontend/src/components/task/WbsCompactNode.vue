<script setup lang="ts">
/**
 * 構成編集マップ用のコンパクトノード（再帰）
 *
 * 整理モードの空親ドロップ:
 * - Sortable の空リストは「常に DOM 上に存在」させる（ドラッグ中に生成すると put 不能）
 * - 見た目の破線枠は mapDragging のときだけ強調
 *
 * 編集モード:
 * - 追加スロットは子列の接続線付き・カードと同じ高さで揃える
 */
import { computed } from 'vue'
import draggable from 'vuedraggable'

defineOptions({ name: 'WbsCompactNode' })

export interface CompactNode {
  taskId: string
  title: string
  wbsCode?: string
  children: CompactNode[]
}

const props = withDefaults(
  defineProps<{
    node: CompactNode
    depth: number
    disabled?: boolean
    editMode?: boolean
    mapDragging?: boolean
    dragGroup: { name: string; pull: boolean; put: boolean }
  }>(),
  {
    disabled: false,
    editMode: false,
    mapDragging: false,
  },
)

const emit = defineEmits<{
  open: [node: CompactNode]
  add: [parentTaskId: string | null]
  delete: [node: CompactNode]
  'drag-start': []
  'drag-end': []
}>()

const canHaveChildren = computed(() => props.depth < 2)

/**
 * 右枝を出す条件
 * - 編集: 追加用に常時
 * - 整理: 子がある OR 空親でも Sortable 用に常時（見た目は CSS で隠す）
 */
const showStructureChrome = computed(() => canHaveChildren.value)

const dragEnabled = computed(() => !props.editMode && !props.disabled)
const showAddSlot = computed(() => props.editMode && canHaveChildren.value)
const isEmptyChildren = computed(() => props.node.children.length === 0)

function childWrapClass(index: number) {
  const n = props.node.children.length
  const onlyReal = n === 1 && !showAddSlot.value
  return {
    'is-first': index === 0,
    'is-last': index === n - 1 && !showAddSlot.value,
    'is-only': onlyReal,
  }
}

function onOpen(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (
    t.closest('.cm-handle') ||
    t.closest('.cm-add-slot') ||
    t.closest('.cm-delete') ||
    t.closest('.cm-drop-label')
  ) {
    return
  }
  emit('open', props.node)
}

function onAddChild(e: Event) {
  e.stopPropagation()
  if (props.disabled || !props.editMode || !canHaveChildren.value) return
  emit('add', props.node.taskId)
}

function onDelete(e: Event) {
  e.stopPropagation()
  if (props.disabled || !props.editMode) return
  emit('delete', props.node)
}

function onChildDragStart() {
  emit('drag-start')
}

function onChildDragEnd() {
  emit('drag-end')
}
</script>

<template>
  <div
    class="cm-unit"
    :class="[
      `cm-depth-${Math.min(depth, 2)}`,
      { 'is-map-dragging': mapDragging },
    ]"
  >
    <div class="cm-row">
      <div
        class="cm-card"
        :class="{ 'is-edit-mode': editMode }"
        role="button"
        tabindex="0"
        @click="onOpen"
        @keydown.enter="emit('open', node)"
      >
        <span
          v-if="!editMode"
          class="cm-handle"
          title="ドラッグして移動・並べ替え"
          @click.stop
        >
          <v-icon size="15">mdi-drag-vertical</v-icon>
        </span>
        <span v-else class="cm-handle-spacer" aria-hidden="true" />
        <span v-if="node.wbsCode" class="cm-wbs">{{ node.wbsCode }}</span>
        <span class="cm-title" :title="node.title">{{ node.title }}</span>
        <span v-if="node.children.length" class="cm-badge">{{
          node.children.length
        }}</span>
        <button
          v-if="editMode"
          type="button"
          class="cm-delete"
          title="タスクを削除"
          :disabled="disabled"
          @click="onDelete"
        >
          <v-icon size="17" color="error">mdi-trash-can-outline</v-icon>
        </button>
      </div>

      <div v-if="showStructureChrome" class="cm-branch">
        <div class="cm-connector-h" aria-hidden="true" />
        <div class="cm-children-col">
          <!--
            空でも常に Sortable リストを維持（ドラッグ開始後に生やすと put できない）
            見た目: 整理+ドラッグ中のみ破線枠 / 編集で空なら高さ0
          -->
          <draggable
            v-model="node.children"
            item-key="taskId"
            handle=".cm-handle"
            :group="dragGroup"
            direction="vertical"
            :animation="0"
            :empty-insert-threshold="20"
            :swap-threshold="0.9"
            :invert-swap="false"
            :force-fallback="true"
            :fallback-on-body="true"
            :fallback-tolerance="4"
            :scroll-sensitivity="60"
            :scroll-speed="12"
            ghost-class="cm-ghost"
            chosen-class="cm-chosen"
            drag-class="cm-drag"
            fallback-class="cm-fallback"
            class="cm-children"
            :class="{
              'is-standby-empty':
                !editMode && isEmptyChildren && !mapDragging,
              'is-empty-drop':
                !editMode && isEmptyChildren && mapDragging,
              'is-drop-active':
                mapDragging && !editMode && !isEmptyChildren,
              'is-edit-collapsed': editMode && isEmptyChildren,
            }"
            :disabled="!dragEnabled"
            @start="onChildDragStart"
            @end="onChildDragEnd"
          >
            <template #item="{ element: child, index }">
              <div class="cm-child-wrap" :class="childWrapClass(index)">
                <WbsCompactNode
                  :node="child"
                  :depth="depth + 1"
                  :disabled="disabled"
                  :edit-mode="editMode"
                  :map-dragging="mapDragging"
                  :drag-group="dragGroup"
                  @open="emit('open', $event)"
                  @add="emit('add', $event)"
                  @delete="emit('delete', $event)"
                  @drag-start="emit('drag-start')"
                  @drag-end="emit('drag-end')"
                />
              </div>
            </template>
          </draggable>

          <div
            v-if="!editMode && isEmptyChildren && mapDragging"
            class="cm-drop-label"
            aria-hidden="true"
          >
            ドロップで子にする
          </div>

          <div
            v-if="showAddSlot"
            class="cm-child-wrap is-add"
            :class="{
              'is-first': isEmptyChildren,
              'is-last': true,
              'is-only': isEmptyChildren,
            }"
          >
            <button
              type="button"
              class="cm-add-slot"
              :class="`add-depth-${Math.min(depth + 1, 2)}`"
              :disabled="disabled"
              title="この下に子タスクを追加"
              @click="onAddChild"
            >
              <v-icon size="14">mdi-plus</v-icon>
              <span>追加</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cm-unit {
  flex-shrink: 0;
}
.cm-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.cm-card {
  display: flex;
  align-items: center;
  gap: 6px;
  width: var(--cm-card-w, 280px);
  min-width: var(--cm-card-w, 280px);
  max-width: var(--cm-card-w, 280px);
  box-sizing: border-box;
  min-height: 40px;
  height: 40px;
  padding: 0 8px 0 10px;
  border-radius: 8px;
  border: 1.5px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  cursor: pointer;
  z-index: 2;
  position: relative;
  flex-shrink: 0;
}
.cm-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  box-shadow: 0 2px 8px rgba(var(--v-theme-primary), 0.08);
}
.cm-card.is-edit-mode {
  padding-right: 6px;
}

.cm-depth-0 > .cm-row > .cm-card {
  border-color: rgba(99, 102, 241, 0.28);
  background: #eef0fb;
  font-weight: 700;
}
.cm-depth-1 > .cm-row > .cm-card {
  border-color: rgba(74, 124, 110, 0.28);
  background: #eef6f2;
}
.cm-depth-2 > .cm-row > .cm-card {
  border-color: rgba(161, 136, 108, 0.32);
  background: #f7f3ec;
}

.cm-handle {
  flex-shrink: 0;
  display: inline-flex;
  width: 16px;
  height: 22px;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: rgba(var(--v-theme-on-surface), 0.35);
  border-radius: 4px;
}
.cm-handle:hover {
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.1);
}
.cm-handle:active {
  cursor: grabbing;
}
.cm-handle-spacer {
  width: 2px;
  flex-shrink: 0;
}
.cm-wbs {
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-primary));
}
.cm-title {
  flex: 1;
  min-width: 0;
  font-size: 0.84rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.cm-badge {
  flex-shrink: 0;
  font-size: 0.6rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 0 5px;
  border-radius: 999px;
}
.cm-delete {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
  cursor: pointer;
}
.cm-delete:hover:not(:disabled) {
  background: rgba(var(--v-theme-error), 0.18);
}
.cm-delete:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cm-branch {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex-shrink: 0;
}
.cm-connector-h {
  width: var(--cm-link, 32px);
  flex-shrink: 0;
  align-self: center;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.3);
  box-sizing: border-box;
}
.cm-children-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: var(--cm-card-w, 280px);
  justify-content: center;
}
.cm-children {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: relative;
  flex-shrink: 0;
  min-width: var(--cm-card-w, 280px);
  min-height: 4px;
  border-radius: 8px;
  box-sizing: border-box;
}

/*
 * 空リスト常駐ヒット領域（透明・固定高・border 幅固定で切替時に跳ばない）
 */
.cm-children.is-standby-empty {
  min-height: 36px;
  border: 2px solid transparent;
  background: transparent;
}
.cm-children.is-empty-drop {
  min-height: 36px;
  border: 2px dashed rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.08);
}
.cm-children.is-drop-active {
  outline: 2px dashed rgba(var(--v-theme-primary), 0.4);
  outline-offset: 0;
  background: rgba(var(--v-theme-primary), 0.04);
}
.cm-children.is-edit-collapsed {
  min-height: 0 !important;
  height: 0;
  overflow: hidden;
  border: none !important;
  outline: none !important;
  background: transparent !important;
  margin: 0;
  padding: 0;
}

.cm-drop-label {
  position: relative;
  margin-top: -36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
  font-size: 0.7rem;
  font-weight: 700;
  color: rgb(var(--v-theme-primary));
}

.cm-child-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  position: relative;
  padding: 4px 0 4px var(--cm-rail, 18px);
  box-sizing: border-box;
  flex-shrink: 0;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.cm-child-wrap.is-first,
.cm-child-wrap.is-add {
  border-top-color: transparent;
}
.cm-child-wrap::before {
  content: '';
  position: absolute;
  left: 0;
  border-left: 2px solid rgba(var(--v-theme-primary), 0.28);
  top: 0;
  bottom: 0;
}
.cm-child-wrap.is-first::before {
  top: 50%;
}
.cm-child-wrap.is-last::before {
  bottom: 50%;
}
.cm-child-wrap.is-only::before {
  display: none;
}
.cm-child-wrap::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: var(--cm-rail, 18px);
  height: 0;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.28);
  margin-top: -1px;
  box-sizing: border-box;
}

.cm-add-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: var(--cm-card-w, 280px);
  min-width: var(--cm-card-w, 280px);
  max-width: var(--cm-card-w, 280px);
  box-sizing: border-box;
  height: 30px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.28);
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}
.cm-add-slot:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
}
.cm-add-slot:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cm-add-slot.add-depth-0 {
  border-color: rgba(99, 102, 241, 0.3);
  background: rgba(238, 240, 251, 0.55);
}
.cm-add-slot.add-depth-1 {
  border-color: rgba(74, 124, 110, 0.3);
  background: rgba(238, 246, 242, 0.55);
}
.cm-add-slot.add-depth-2 {
  border-color: rgba(161, 136, 108, 0.32);
  background: rgba(247, 243, 236, 0.6);
}

:deep(.cm-ghost) {
  opacity: 0.25;
}
:deep(.cm-ghost) .cm-card {
  border-style: dashed;
  background: rgba(var(--v-theme-primary), 0.06) !important;
}
:deep(.cm-fallback) {
  opacity: 0.95;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}
:deep(.cm-chosen) .cm-card {
  border-color: rgb(var(--v-theme-primary));
}
:deep(.cm-drag) {
  opacity: 0.9;
}
</style>
