<script setup lang="ts">
// プロジェクト詳細ダイアログ
// 名・説明・タスク数・メンバー（表示名）を表示し、かんばん等へ誘導する
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Project } from '@/types/project'
import { projectStatusLabel, projectStatusColor } from '@/types/project'
import { useProjectsStore } from '@/stores/projects'
import { useTasksStore } from '@/stores/tasks'
import { useAuthStore } from '@/stores/auth'
import { resolveMemberDisplayName, avatarLabelFromName } from '@/utils/displayName'

const props = defineProps<{
  project?: Project | null
}>()

const modelValue = defineModel<boolean>({ default: false })

const router = useRouter()
const projectsStore = useProjectsStore()
const tasksStore = useTasksStore()
const authStore = useAuthStore()

const isLoadingDetail = ref(false)
const loadError = ref('')

/** ストア上の最新プロジェクト（表示名 enrich 後を優先） */
const liveProject = computed(() => {
  if (!props.project) return null
  if (projectsStore.currentProject?.projectId === props.project.projectId) {
    return projectsStore.currentProject
  }
  return (
    projectsStore.projects.find((p) => p.projectId === props.project!.projectId) ||
    props.project
  )
})

const projectId = computed(() => liveProject.value?.projectId ?? props.project?.projectId ?? '')

/** このプロジェクトのタスク数（ensureTasks 済みならストアから） */
const taskCount = computed(() => {
  const id = projectId.value
  if (!id) return 0
  if (tasksStore.currentProjectId === id) {
    return tasksStore.activeTasks.length
  }
  return null as number | null
})

const members = computed(() => {
  const p = liveProject.value
  if (!p) return []
  const list = [...(p.members ?? [])]
  if (list.length === 0 && p.memberIds?.length) {
    return p.memberIds.map((id) => ({
      userId: id,
      email: '',
      displayName: id === authStore.currentUser?.sub ? authStore.displayLabel : id.slice(0, 8),
    }))
  }
  return list.sort((a, b) => {
    if (a.userId === p.createdBy) return -1
    if (b.userId === p.createdBy) return 1
    return resolveMemberDisplayName(a).localeCompare(resolveMemberDisplayName(b), 'ja')
  })
})

const isOwner = computed(() => {
  const p = liveProject.value
  const sub = authStore.currentUser?.sub
  return !!(p && sub && p.createdBy === sub)
})

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

async function loadDetail(): Promise<void> {
  const id = props.project?.projectId
  if (!id) return
  loadError.value = ''
  isLoadingDetail.value = true
  try {
    await Promise.all([
      projectsStore.ensureProject(id),
      tasksStore.ensureTasks(id),
    ])
  } catch {
    loadError.value = 'プロジェクト情報の取得に失敗しました'
  } finally {
    isLoadingDetail.value = false
  }
}

watch(modelValue, (open) => {
  if (open && props.project?.projectId) {
    void loadDetail()
  }
})

function goToBoard() {
  const id = projectId.value
  if (!id) return
  modelValue.value = false
  void router.push({ name: 'task-board', params: { projectId: id } })
}

function goToTable() {
  const id = projectId.value
  if (!id) return
  modelValue.value = false
  void router.push({ name: 'task-table', params: { projectId: id } })
}

const emit = defineEmits<{
  edit: [project: Project]
  delete: [project: Project]
}>()

function onEdit() {
  const p = liveProject.value
  if (!p) return
  modelValue.value = false
  emit('edit', p)
}

function onDelete() {
  const p = liveProject.value
  if (!p) return
  modelValue.value = false
  emit('delete', p)
}
</script>

<template>
  <v-dialog v-model="modelValue" max-width="560" scrollable>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5 d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-folder</v-icon>
        <span class="text-truncate">{{ liveProject?.name || 'プロジェクト詳細' }}</span>
        <v-chip
          v-if="liveProject"
          :color="projectStatusColor(liveProject.status)"
          size="x-small"
          variant="tonal"
          class="ml-2"
        >
          {{ projectStatusLabel(liveProject.status) }}
        </v-chip>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" @click="modelValue = false" />
      </v-card-title>

      <v-divider />

      <v-card-text class="px-5 py-4">
        <v-alert
          v-if="loadError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ loadError }}
        </v-alert>

        <div v-if="isLoadingDetail && !liveProject" class="py-6 text-center">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <template v-else-if="liveProject">
          <!-- プロジェクト名 -->
          <div class="mb-4">
            <p class="text-caption text-medium-emphasis mb-1">プロジェクト名</p>
            <p class="text-body-1 font-weight-bold mb-0">{{ liveProject.name }}</p>
          </div>

          <!-- 説明 -->
          <div class="mb-4">
            <p class="text-caption text-medium-emphasis mb-1">説明</p>
            <p
              v-if="liveProject.description"
              class="text-body-2 mb-0"
              style="white-space: pre-wrap"
            >
              {{ liveProject.description }}
            </p>
            <p v-else class="text-body-2 text-medium-emphasis mb-0">説明は設定されていません</p>
          </div>

          <!-- 統計 -->
          <v-row dense class="mb-4">
            <v-col cols="6">
              <v-card variant="tonal" rounded="lg" class="pa-3">
                <div class="d-flex align-center">
                  <v-icon color="primary" class="mr-2">mdi-checkbox-marked-outline</v-icon>
                  <div>
                    <p class="text-caption text-medium-emphasis mb-0">タスク数</p>
                    <p class="text-h6 font-weight-bold mb-0">
                      <template v-if="taskCount !== null">{{ taskCount }}</template>
                      <template v-else>
                        <v-progress-circular indeterminate size="16" width="2" />
                      </template>
                      <span class="text-body-2 font-weight-regular ml-1">件</span>
                    </p>
                  </div>
                </div>
              </v-card>
            </v-col>
            <v-col cols="6">
              <v-card variant="tonal" rounded="lg" class="pa-3">
                <div class="d-flex align-center">
                  <v-icon color="primary" class="mr-2">mdi-account-group</v-icon>
                  <div>
                    <p class="text-caption text-medium-emphasis mb-0">メンバー</p>
                    <p class="text-h6 font-weight-bold mb-0">
                      {{ members.length }}
                      <span class="text-body-2 font-weight-regular">人</span>
                    </p>
                  </div>
                </div>
              </v-card>
            </v-col>
          </v-row>

          <p class="text-caption text-medium-emphasis mb-2">
            作成日: {{ formatDate(liveProject.createdAt) }}
          </p>

          <v-divider class="mb-3" />

          <!-- メンバー一覧（表示名） -->
          <p class="text-subtitle-2 font-weight-bold mb-2">チームメンバー</p>
          <v-list v-if="members.length > 0" class="pa-0 mb-2" density="comfortable">
            <v-list-item
              v-for="(member, idx) in members"
              :key="member.userId || member.email || String(idx)"
              class="px-2 mb-1"
              rounded="lg"
              border
            >
              <template #prepend>
                <v-avatar color="primary" size="36">
                  <span class="text-caption text-white">
                    {{ avatarLabelFromName(resolveMemberDisplayName(member)) }}
                  </span>
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ resolveMemberDisplayName(member) }}
                <v-chip
                  v-if="member.userId === liveProject.createdBy"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="ml-2"
                >
                  オーナー
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ member.email || '—' }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
          <p v-else class="text-body-2 text-medium-emphasis">メンバー情報がありません</p>
        </template>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-5 py-3 flex-wrap ga-2">
        <v-btn
          color="primary"
          prepend-icon="mdi-view-column"
          :disabled="!projectId"
          @click="goToBoard"
        >
          かんばんを開く
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-table"
          :disabled="!projectId"
          @click="goToTable"
        >
          テーブルを開く
        </v-btn>
        <v-spacer />
        <v-btn
          icon="mdi-pencil"
          variant="text"
          size="small"
          title="編集する"
          @click="onEdit"
        />
        <v-btn
          v-if="isOwner"
          icon="mdi-delete"
          variant="text"
          size="small"
          color="error"
          title="削除する"
          @click="onDelete"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
