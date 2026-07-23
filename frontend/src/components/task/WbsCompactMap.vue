<script setup lang="ts">
/**
 * 構成編集用コンパクト・マインドマップ
 * - 整理: ローカル DnD のみ → 「保存」で一括反映
 * - 編集: 追加・削除（即時 API）
 * - 背景ガイドはスクロール領域いっぱいに延伸
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import draggable from 'vuedraggable'
import type { Task } from '@/types/task'
import { WBS_MAX_DEPTH_INDEX, childrenOf } from '@/utils/wbs'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import WbsCompactNode, {
  type CompactNode,
} from './WbsCompactNode.vue'

const props = defineProps<{
  tasks: Task[]
  projectName: string
  projectId: string
  busy?: boolean
}>()

const emit = defineEmits<{
  open: [task: Task]
  add: [parentTaskId: string | null]
  busy: [value: boolean]
  /** 構造保存成功（親が renumber 前に呼べる） */
  saved: []
}>()

const tasksStore = useTasksStore()
const uiStore = useUiStore()

const mapMode = ref<'organize' | 'edit'>('organize')
const isEditMode = computed(() => mapMode.value === 'edit')
const deleting = ref(false)
/** 未保存の構造変更あり */
const dirty = ref(false)

function buildTree(tasks: Task[]): CompactNode[] {
  function walk(parentId: string | null): CompactNode[] {
    return childrenOf(tasks, parentId, 'asc', 'sortOrder').map((t) => ({
      taskId: t.taskId,
      title: t.title,
      wbsCode: t.wbsCode,
      children: walk(t.taskId),
    }))
  }
  return walk(null)
}

const tree = ref<CompactNode[]>([])
const dragging = ref(false)
const localBusy = ref(false)
const mapRef = ref<HTMLElement | null>(null)

const CM_LINK = 28
const CM_RAIL = 16

function applyMetrics() {
  const el = mapRef.value
  if (!el) return
  const padX = 32
  const available = Math.max(0, el.clientWidth - padX)
  const segs = 3 * (CM_LINK + CM_RAIL)
  const raw = Math.floor((available - segs) / 4)
  const cardW = Math.max(240, Math.min(raw, 480))
  const step = cardW + CM_LINK + CM_RAIL
  el.style.setProperty('--cm-card-w', `${cardW}px`)
  el.style.setProperty('--cm-link', `${CM_LINK}px`)
  el.style.setProperty('--cm-rail', `${CM_RAIL}px`)
  const pad = 16
  el.style.setProperty('--cm-guide-1', `${pad + cardW + CM_LINK / 2}px`)
  el.style.setProperty('--cm-guide-2', `${pad + cardW + step + CM_LINK / 2}px`)
  el.style.setProperty(
    '--cm-guide-3',
    `${pad + cardW + 2 * step + CM_LINK / 2}px`,
  )
}

let ro: ResizeObserver | null = null
onMounted(() => {
  applyMetrics()
  if (mapRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => applyMetrics())
    ro.observe(mapRef.value)
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
})

watch(
  () => props.tasks,
  (list) => {
    // 未保存のローカル整理中はサーバ反映で上書きしない
    if (dragging.value || localBusy.value || dirty.value) return
    tree.value = buildTree(list)
  },
  { immediate: true, deep: true },
)

const taskById = computed(() => {
  const m = new Map<string, Task>()
  for (const t of props.tasks) m.set(t.taskId, t)
  return m
})

function openNode(node: CompactNode) {
  const t = taskById.value.get(node.taskId)
  if (t) emit('open', t)
}

function onAdd(parentTaskId: string | null) {
  if (props.busy || localBusy.value || !isEditMode.value) return
  emit('add', parentTaskId)
}

async function onDelete(node: CompactNode) {
  if (props.busy || localBusy.value || deleting.value || !isEditMode.value) {
    return
  }
  if (dirty.value) {
    uiStore.showError(
      '未保存の並べ替えがあります。先に「構造を保存」するか破棄してください。',
    )
    return
  }
  const label = node.wbsCode ? `${node.wbsCode} ${node.title}` : node.title
  const hasKids = node.children.length > 0
  const msg = hasKids
    ? `「${label}」とその子孫タスクを削除します。よろしいですか？`
    : `「${label}」を削除します。よろしいですか？`
  if (!window.confirm(msg)) return

  deleting.value = true
  emit('busy', true)
  try {
    await tasksStore.deleteTask(node.taskId)
  } catch {
    // store toast
  } finally {
    deleting.value = false
    emit('busy', false)
    tree.value = buildTree(tasksStore.activeTasks)
  }
}

function treeMaxDepth(nodes: CompactNode[], depth = 0): number {
  let max = nodes.length ? depth : -1
  for (const n of nodes) {
    if (n.children.length) {
      max = Math.max(max, treeMaxDepth(n.children, depth + 1))
    } else {
      max = Math.max(max, depth)
    }
  }
  return max
}

function flattenDesired(
  nodes: CompactNode[],
  parentId: string | null,
): Array<{ taskId: string; parentId: string | null; sortOrder: number }> {
  const out: Array<{
    taskId: string
    parentId: string | null
    sortOrder: number
  }> = []
  nodes.forEach((n, i) => {
    out.push({ taskId: n.taskId, parentId, sortOrder: i })
    out.push(...flattenDesired(n.children, n.taskId))
  })
  return out
}

function hasCycle(nodes: CompactNode[]): boolean {
  const path = new Set<string>()
  function walk(list: CompactNode[]): boolean {
    for (const n of list) {
      if (path.has(n.taskId)) return true
      path.add(n.taskId)
      if (walk(n.children)) return true
      path.delete(n.taskId)
    }
    return false
  }
  return walk(nodes)
}

function subtreeHeightOfNode(node: CompactNode): number {
  if (!node.children.length) return 1
  let max = 0
  for (const c of node.children) {
    max = Math.max(max, subtreeHeightOfNode(c))
  }
  return 1 + max
}

function violatesDepth(nodes: CompactNode[], depth = 0): boolean {
  for (const n of nodes) {
    if (depth + subtreeHeightOfNode(n) - 1 > WBS_MAX_DEPTH_INDEX) return true
    if (violatesDepth(n.children, depth + 1)) return true
  }
  return false
}

function restoreFromStore() {
  dirty.value = false
  tree.value = buildTree(tasksStore.activeTasks)
}

function markDirty() {
  dirty.value = true
}

function onDiscard() {
  if (!dirty.value) return
  if (!window.confirm('未保存の並べ替えを破棄しますか？')) return
  restoreFromStore()
}

/**
 * ローカルツリーを API に一括反映
 * @returns 成功したか
 */
async function commitTree(options?: {
  silentSuccess?: boolean
}): Promise<boolean> {
  const snapshot = JSON.parse(JSON.stringify(tree.value)) as CompactNode[]

  if (hasCycle(snapshot)) {
    uiStore.showError('親子関係が循環しています。元に戻します。')
    restoreFromStore()
    return false
  }
  if (violatesDepth(snapshot) || treeMaxDepth(snapshot) > WBS_MAX_DEPTH_INDEX) {
    uiStore.showError(`WBS の深さは ${WBS_MAX_DEPTH_INDEX + 1} 階層までです`)
    restoreFromStore()
    return false
  }

  const desired = flattenDesired(snapshot, null)
  const baseline = new Map(
    tasksStore.activeTasks.map((t) => [t.taskId, t] as const),
  )

  let changed = false
  for (const d of desired) {
    const t = baseline.get(d.taskId)
    if (!t) continue
    if (
      (t.parentTaskId || null) !== d.parentId ||
      (t.sortOrder ?? 0) !== d.sortOrder
    ) {
      changed = true
      break
    }
  }
  if (!changed) {
    dirty.value = false
    return true
  }

  localBusy.value = true
  emit('busy', true)
  tree.value = snapshot

  try {
    for (const d of desired) {
      const t = baseline.get(d.taskId)
      if (!t) continue
      if ((t.parentTaskId || null) !== d.parentId) {
        await tasksStore.moveTask(
          d.taskId,
          { newParentId: d.parentId, sortOrder: d.sortOrder },
          { silent: true },
        )
      }
    }

    const latest = tasksStore.activeTasks
    const groups = new Map<string | null, string[]>()
    for (const d of desired) {
      if (!groups.has(d.parentId)) groups.set(d.parentId, [])
      groups.get(d.parentId)!.push(d.taskId)
    }
    for (const [parentId, orderedIds] of groups) {
      const current = childrenOf(latest, parentId, 'asc', 'sortOrder').map(
        (t) => t.taskId,
      )
      const same =
        current.length === orderedIds.length &&
        current.every((id, i) => id === orderedIds[i])
      if (same) continue
      await tasksStore.reorderTasks(
        props.projectId,
        {
          parentTaskId: parentId,
          items: orderedIds.map((taskId, sortOrder) => ({ taskId, sortOrder })),
        },
        { silent: true },
      )
    }

    dirty.value = false
    if (!options?.silentSuccess) {
      uiStore.showSuccess('構造を保存しました')
    }
    emit('saved')
    await nextTick()
    tree.value = buildTree(tasksStore.activeTasks)
    return true
  } catch (e) {
    console.error(e)
    uiStore.showError('構成の保存に失敗しました。元に戻します。')
    restoreFromStore()
    return false
  } finally {
    localBusy.value = false
    emit('busy', false)
    applyMetrics()
  }
}

async function onSave() {
  if (!dirty.value || localBusy.value) return
  await commitTree()
}

/** 親から番号振り直し前に呼ぶ（未保存なら先に保存） */
async function saveIfDirty(): Promise<boolean> {
  if (!dirty.value) return true
  return commitTree({ silentSuccess: true })
}

defineExpose({ saveIfDirty, dirty, commitTree })

/** ドラッグ開始時のスナップショット（深さ違反時に戻す） */
let dragSnapshot: CompactNode[] | null = null

function cloneTree(nodes: CompactNode[]): CompactNode[] {
  return JSON.parse(JSON.stringify(nodes)) as CompactNode[]
}

function onDragStart() {
  dragSnapshot = cloneTree(tree.value)
  dragging.value = true
}

function onDragEnd() {
  dragging.value = false
  // 深さチェック: 子持ちを第3層へ等は不可
  if (hasCycle(tree.value)) {
    uiStore.showError('親子関係が循環しています。元に戻します。')
    if (dragSnapshot) tree.value = dragSnapshot
    dragSnapshot = null
    return
  }
  if (violatesDepth(tree.value) || treeMaxDepth(tree.value) > WBS_MAX_DEPTH_INDEX) {
    uiStore.showError(
      '第3層には子を持てません。子タスクを外してから第3層へ移動してください。',
    )
    if (dragSnapshot) tree.value = dragSnapshot
    dragSnapshot = null
    return
  }
  dragSnapshot = null
  // サーバには送らずローカル dirty のみ
  markDirty()
}

const dragGroup = computed(() => ({
  name: 'wbs-compact-map',
  pull: !isEditMode.value,
  put: !isEditMode.value,
}))

watch(mapMode, (mode) => {
  if (mode === 'edit' && dirty.value) {
    uiStore.showError(
      '未保存の並べ替えがあります。編集の前に保存または破棄してください。',
    )
    mapMode.value = 'organize'
  }
})
</script>

<template>
  <div class="cm-shell">
    <div class="cm-mode-bar d-flex align-center flex-wrap ga-2 mb-2">
      <v-btn-toggle
        v-model="mapMode"
        mandatory
        density="comfortable"
        color="primary"
        rounded="lg"
        divided
        class="cm-mode-toggle"
      >
        <v-btn size="small" value="organize" prepend-icon="mdi-cursor-move">
          整理
        </v-btn>
        <v-btn size="small" value="edit" prepend-icon="mdi-pencil-outline">
          編集
        </v-btn>
      </v-btn-toggle>

      <template v-if="mapMode === 'organize'">
        <v-btn
          size="small"
          color="primary"
          variant="flat"
          rounded="lg"
          prepend-icon="mdi-content-save-outline"
          :disabled="!dirty || busy || localBusy"
          :loading="localBusy"
          @click="onSave"
        >
          構造を保存
        </v-btn>
        <v-btn
          v-if="dirty"
          size="small"
          variant="text"
          rounded="lg"
          @click="onDiscard"
        >
          破棄
        </v-btn>
        <v-chip
          v-if="dirty"
          size="small"
          color="warning"
          variant="tonal"
          label
        >
          未保存
        </v-chip>
      </template>

      <span class="text-caption text-medium-emphasis cm-mode-hint">
        <template v-if="mapMode === 'organize'">
          ドラッグ中のみ破線枠表示。子持ちは第3層不可。完了後「構造を保存」。
        </template>
        <template v-else>
          「追加」で新規 · ゴミ箱で削除（子孫も削除）。
        </template>
      </span>
    </div>

    <div
      ref="mapRef"
      class="cm-map"
      :class="{
        'is-busy': busy || localBusy || deleting,
        'is-dragging': dragging,
        'is-edit-mode': isEditMode,
      }"
    >
      <!-- 内側をコンテンツ高 or ビューポート高の大きい方にし、ガイドを全面に -->
      <div class="cm-map-inner">
        <div class="cm-guides" aria-hidden="true">
          <div class="cm-vguide g1" />
          <div class="cm-vguide g2" />
          <div class="cm-vguide g3" />
        </div>
        <div class="cm-col-labels">
          <span class="cm-col-lbl" style="left: 16px">プロジェクト</span>
          <span class="cm-col-lbl" :style="{ left: 'var(--cm-guide-1)' }">第1層</span>
          <span class="cm-col-lbl" :style="{ left: 'var(--cm-guide-2)' }">第2層</span>
          <span class="cm-col-lbl" :style="{ left: 'var(--cm-guide-3)' }">第3層</span>
        </div>

        <div class="cm-canvas">
          <div class="cm-project-root">
            <div class="cm-project-card">
              <v-icon size="18" color="primary">mdi-folder-outline</v-icon>
              <span class="cm-project-name">{{ projectName }}</span>
            </div>
            <div class="cm-project-branch">
              <div class="cm-connector-h proj" aria-hidden="true" />
              <div class="cm-root-col">
                <draggable
                  v-model="tree"
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
                  fallback-class="cm-fallback"
                  class="cm-root-children"
                  :class="{
                    'is-standby-empty':
                      !isEditMode && tree.length === 0 && !dragging,
                    'is-empty-drop':
                      dragging && !isEditMode && tree.length === 0,
                    'is-drop-active':
                      dragging && !isEditMode && tree.length > 0,
                  }"
                  :disabled="busy || localBusy || isEditMode"
                  @start="onDragStart"
                  @end="onDragEnd"
                >
                  <template #item="{ element: node, index }">
                    <div
                      class="cm-child-wrap root"
                      :class="{
                        'is-first': index === 0,
                        'is-last':
                          index === tree.length - 1 && !isEditMode,
                        'is-only': tree.length === 1 && !isEditMode,
                      }"
                    >
                      <WbsCompactNode
                        :node="node"
                        :depth="0"
                        :disabled="busy || localBusy || deleting"
                        :edit-mode="isEditMode"
                        :map-dragging="dragging"
                        :drag-group="dragGroup"
                        @open="openNode"
                        @add="onAdd"
                        @delete="onDelete"
                        @drag-start="onDragStart"
                        @drag-end="onDragEnd"
                      />
                    </div>
                  </template>
                </draggable>
                <div
                  v-if="dragging && !isEditMode && tree.length === 0"
                  class="cm-drop-hint root-hint"
                  aria-hidden="true"
                >
                  <span class="cm-drop-hint-label">ドロップでルートに</span>
                </div>
                <!-- 編集: ルート追加も接続線付き -->
                <div
                  v-if="isEditMode"
                  class="cm-child-wrap root is-add"
                  :class="{
                    'is-first': tree.length === 0,
                    'is-last': true,
                    'is-only': tree.length === 0,
                  }"
                >
                  <button
                    type="button"
                    class="cm-add-slot root-add"
                    :disabled="busy || localBusy || deleting"
                    title="ルートタスクを追加"
                    @click="onAdd(null)"
                  >
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>追加</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cm-shell {
  width: 100%;
}
.cm-mode-bar {
  padding: 0 2px;
}
.cm-mode-toggle :deep(.v-btn) {
  text-transform: none;
  letter-spacing: 0.01em;
}
.cm-mode-hint {
  line-height: 1.4;
  max-width: 560px;
}

.cm-map {
  --cm-card-w: 280px;
  --cm-link: 28px;
  --cm-rail: 16px;
  --cm-guide-1: 310px;
  --cm-guide-2: 634px;
  --cm-guide-3: 958px;
  position: relative;
  overflow: auto;
  /* 固定ビューポート高 → 内側 min-height:100% でガイドが底まで届く */
  height: calc(100vh - 260px);
  min-height: 360px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  box-sizing: border-box;
}
.cm-map.is-busy {
  opacity: 0.75;
  pointer-events: none;
}

/* スクロール内容全体の高さ（最低でもマップ枠いっぱい） */
.cm-map-inner {
  position: relative;
  min-height: 100%;
  min-width: max(
    100%,
    calc(var(--cm-card-w) * 4 + var(--cm-link) * 3 + var(--cm-rail) * 3 + 40px)
  );
  width: max-content;
  box-sizing: border-box;
}

/* ガイドは inner に張り付き（ツリーと一体でスクロール） */
.cm-guides {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}
.cm-vguide {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 2px dashed rgba(var(--v-theme-primary), 0.22);
}
.cm-vguide.g1 {
  left: var(--cm-guide-1);
}
.cm-vguide.g2 {
  left: var(--cm-guide-2);
}
.cm-vguide.g3 {
  left: var(--cm-guide-3);
}

.cm-col-labels {
  position: sticky;
  top: 0;
  height: 44px;
  z-index: 3;
  background: linear-gradient(
    to bottom,
    rgb(var(--v-theme-surface)) 70%,
    rgba(var(--v-theme-surface), 0.92) 85%,
    transparent
  );
  pointer-events: none;
}
.cm-col-lbl {
  position: absolute;
  top: 14px;
  transform: translateX(8px);
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-primary), 0.55);
}

.cm-canvas {
  position: relative;
  z-index: 1;
  padding: 12px 16px 40px;
}

.cm-project-root {
  display: flex;
  flex-direction: row;
  align-items: center;
}
.cm-project-card {
  display: flex;
  align-items: center;
  gap: 8px;
  width: var(--cm-card-w);
  min-width: var(--cm-card-w);
  max-width: var(--cm-card-w);
  box-sizing: border-box;
  min-height: 48px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #eaf4fa;
  border: 1.5px solid rgba(90, 140, 170, 0.35);
  z-index: 2;
  flex-shrink: 0;
}
.cm-project-name {
  font-weight: 800;
  font-size: 0.9rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.cm-project-branch {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex-shrink: 0;
}
.cm-connector-h {
  width: var(--cm-link);
  flex-shrink: 0;
  align-self: center;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.35);
  box-sizing: border-box;
}
.cm-root-col {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: var(--cm-card-w);
}
.cm-root-children {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex-shrink: 0;
  min-height: 8px;
  min-width: var(--cm-card-w);
  border-radius: 8px;
  box-sizing: border-box;
}
.cm-root-children.is-standby-empty {
  min-height: 36px;
  border: 2px solid transparent;
}
.cm-root-children.is-empty-drop {
  min-height: 36px;
  border: 2px dashed rgba(var(--v-theme-primary), 0.55);
  background: rgba(var(--v-theme-primary), 0.08);
}
.cm-root-children.is-drop-active {
  outline: 2px dashed rgba(var(--v-theme-primary), 0.4);
  outline-offset: 0;
  background: rgba(var(--v-theme-primary), 0.04);
}

.cm-drop-hint.root-hint {
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

.cm-add-slot.root-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: var(--cm-card-w);
  min-width: var(--cm-card-w);
  max-width: var(--cm-card-w);
  box-sizing: border-box;
  height: 30px;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1.5px dashed rgba(99, 102, 241, 0.32);
  background: rgba(238, 240, 251, 0.6);
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
}
.cm-add-slot.root-add:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.cm-add-slot.root-add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cm-child-wrap.root {
  display: flex;
  flex-direction: row;
  align-items: center;
  position: relative;
  padding: 4px 0 4px var(--cm-rail);
  box-sizing: border-box;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}
.cm-child-wrap.root.is-first,
.cm-child-wrap.root.is-add {
  border-top-color: transparent;
}
.cm-child-wrap.root::before {
  content: '';
  position: absolute;
  left: 0;
  border-left: 2px solid rgba(var(--v-theme-primary), 0.32);
  top: 0;
  bottom: 0;
}
.cm-child-wrap.root.is-first::before {
  top: 50%;
}
.cm-child-wrap.root.is-last::before {
  bottom: 50%;
}
.cm-child-wrap.root.is-only::before {
  display: none;
}
.cm-child-wrap.root::after {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: var(--cm-rail);
  height: 0;
  border-top: 2px solid rgba(var(--v-theme-primary), 0.32);
  margin-top: -1px;
}

:deep(.cm-fallback) {
  opacity: 0.95;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
}

.cm-map.is-dragging .cm-vguide {
  border-left-color: rgba(var(--v-theme-primary), 0.45);
  border-left-style: solid;
}

:deep(.cm-ghost) {
  opacity: 0.4;
}
</style>
