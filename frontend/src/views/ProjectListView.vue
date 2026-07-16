<script setup lang="ts">
// プロジェクト一覧ページ
// カードクリックで詳細ダイアログを開き、そこからかんばん等へ遷移する
import { ref, onMounted } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import type { Project } from '@/types/project'
import ProjectForm from '@/components/project/ProjectForm.vue'
import ProjectDetailDialog from '@/components/project/ProjectDetailDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import { projectStatusLabel, projectStatusColor } from '@/types/project'

const projectsStore = useProjectsStore()

const showForm = ref(false)
const editingProject = ref<Project | null>(null)
const showDeleteConfirm = ref(false)
const deletingProject = ref<Project | null>(null)
const showDetail = ref(false)
const detailProject = ref<Project | null>(null)

function openCreateForm() {
  editingProject.value = null
  showForm.value = true
}

function openEditForm(project: Project) {
  editingProject.value = project
  showForm.value = true
}

function openDeleteConfirm(project: Project) {
  deletingProject.value = project
  showDeleteConfirm.value = true
}

async function handleDelete() {
  if (!deletingProject.value) return
  await projectsStore.deleteProject(deletingProject.value.projectId)
  showDeleteConfirm.value = false
  deletingProject.value = null
}

/** カード全体クリック → 詳細ダイアログ */
function openDetail(project: Project) {
  detailProject.value = project
  showDetail.value = true
}

function memberCount(project: Project): number {
  return project.members?.length || project.memberIds?.length || 1
}

function getStatusLabel(status: string): string {
  return projectStatusLabel(status)
}

function getStatusColor(status: string): string {
  return projectStatusColor(status)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

onMounted(() => {
  void projectsStore.fetchProjects()
})
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-6">
      <v-icon size="32" color="primary" class="mr-3">mdi-folder-multiple</v-icon>
      <h1 class="text-h5 font-weight-bold">プロジェクト一覧</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateForm">
        新しいプロジェクトを作成する
      </v-btn>
    </div>

    <v-row v-if="projectsStore.isLoading && projectsStore.projects.length === 0">
      <v-col v-for="i in 6" :key="i" cols="12" sm="6" lg="4">
        <v-skeleton-loader type="card" />
      </v-col>
    </v-row>

    <v-row v-else-if="projectsStore.projects.length > 0">
      <v-col
        v-for="project in projectsStore.projects"
        :key="project.projectId"
        cols="12"
        sm="6"
        lg="4"
      >
        <v-card
          rounded="lg"
          hover
          height="100%"
          class="project-card"
          role="button"
          tabindex="0"
          @click="openDetail(project)"
          @keydown.enter.prevent="openDetail(project)"
        >
          <v-card-title class="d-flex align-center pt-4">
            <span class="text-subtitle-1 font-weight-bold flex-grow-1 text-truncate">
              {{ project.name }}
            </span>
            <v-chip
              :color="getStatusColor(project.status)"
              size="x-small"
              variant="tonal"
              class="ml-2"
            >
              {{ getStatusLabel(project.status) }}
            </v-chip>
          </v-card-title>

          <v-card-text>
            <p
              v-if="project.description"
              class="text-body-2 text-medium-emphasis mb-3 project-desc"
            >
              {{ project.description }}
            </p>
            <p v-else class="text-body-2 text-medium-emphasis mb-3">説明なし</p>

            <div class="d-flex align-center text-caption text-medium-emphasis">
              <v-icon size="14" class="mr-1">mdi-calendar</v-icon>
              作成日: {{ formatDate(project.createdAt) }}
              <v-spacer />
              <v-icon size="14" class="mr-1">mdi-account-group</v-icon>
              {{ memberCount(project) }} 人
            </div>
            <p class="text-caption text-primary mt-3 mb-0">
              クリックで詳細を表示
            </p>
          </v-card-text>

          <v-card-actions @click.stop>
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-information-outline"
              @click="openDetail(project)"
            >
              詳細を見る
            </v-btn>
            <v-spacer />
            <v-btn
              icon="mdi-pencil"
              variant="text"
              size="small"
              title="編集する"
              @click="openEditForm(project)"
            />
            <v-btn
              icon="mdi-delete"
              variant="text"
              size="small"
              color="error"
              title="削除する"
              @click="openDeleteConfirm(project)"
            />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <v-card v-else class="text-center pa-12" rounded="lg" variant="tonal">
      <v-icon size="64" color="medium-emphasis" class="mb-4">mdi-folder-open-outline</v-icon>
      <h2 class="text-h6 font-weight-bold mb-2">プロジェクトがまだありません</h2>
      <p class="text-body-2 text-medium-emphasis mb-6">
        最初のプロジェクトを作成して、チームのタスク管理をはじめましょう
      </p>
      <v-btn
        color="primary"
        size="large"
        prepend-icon="mdi-plus"
        @click="openCreateForm"
      >
        最初のプロジェクトを作成する
      </v-btn>
    </v-card>

    <ProjectDetailDialog
      v-model="showDetail"
      :project="detailProject"
      @edit="openEditForm"
      @delete="openDeleteConfirm"
    />

    <!-- project は null=新規 / オブジェクト=編集（ProjectForm が computed で判定） -->
    <ProjectForm v-model="showForm" :project="editingProject" />

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="プロジェクトを削除しますか？"
      :message="`「${deletingProject?.name}」を削除します。この操作は元に戻せません。`"
      confirm-text="削除する"
      confirm-color="error"
      :loading="projectsStore.isLoading"
      @confirm="handleDelete"
    />
  </v-container>
</template>

<style scoped>
.project-card {
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.1s ease;
}

.project-card:hover {
  transform: translateY(-2px);
}

.project-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
