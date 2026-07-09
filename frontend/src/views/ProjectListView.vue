<script setup lang="ts">
// プロジェクト一覧ページ
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import type { Project } from '@/types/project'
import ProjectForm from '@/components/project/ProjectForm.vue'
import ProjectMembersDialog from '@/components/project/ProjectMembersDialog.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'

const router = useRouter()
const projectsStore = useProjectsStore()

// プロジェクト作成・編集ダイアログの表示状態
const showForm = ref(false)
// 編集対象のプロジェクト（null の場合は新規作成）
const editingProject = ref<Project | null>(null)
// 削除確認ダイアログの表示状態
const showDeleteConfirm = ref(false)
// 削除対象のプロジェクト
const deletingProject = ref<Project | null>(null)
// メンバー管理ダイアログ
const showMembers = ref(false)
const membersProject = ref<Project | null>(null)

/** 新規プロジェクト作成ダイアログを開く */
function openCreateForm() {
  editingProject.value = null
  showForm.value = true
}

/** プロジェクト編集ダイアログを開く */
function openEditForm(project: Project) {
  editingProject.value = project
  showForm.value = true
}

/** 削除確認ダイアログを開く */
function openDeleteConfirm(project: Project) {
  deletingProject.value = project
  showDeleteConfirm.value = true
}

/** プロジェクトを削除する */
async function handleDelete() {
  if (!deletingProject.value) return
  await projectsStore.deleteProject(deletingProject.value.projectId)
  showDeleteConfirm.value = false
  deletingProject.value = null
}

/** プロジェクトのかんばんビューへ移動する */
function goToBoard(projectId: string) {
  router.push({ name: 'task-board', params: { projectId } })
}

/** メンバー管理ダイアログを開く */
function openMembers(project: Project) {
  membersProject.value = project
  showMembers.value = true
}

/** メンバー数を表示する */
function memberCount(project: Project): number {
  return project.members?.length || project.memberIds?.length || 1
}

/** ステータスのラベルを返す */
function getStatusLabel(status: string): string {
  return status === 'active' ? 'アクティブ' : 'アーカイブ済み'
}

/** ステータスのカラーを返す */
function getStatusColor(status: string): string {
  return status === 'active' ? 'success' : 'grey'
}

/** 作成日時をフォーマットする */
function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

onMounted(() => {
  projectsStore.fetchProjects()
})
</script>

<template>
  <v-container class="py-6">
    <!-- ページヘッダー -->
    <div class="d-flex align-center mb-6">
      <v-icon size="32" color="primary" class="mr-3">mdi-folder-multiple</v-icon>
      <h1 class="text-h5 font-weight-bold">プロジェクト一覧</h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreateForm"
      >
        新しいプロジェクトを作成する
      </v-btn>
    </div>

    <!-- ローディング中のスケルトン表示 -->
    <v-row v-if="projectsStore.isLoading">
      <v-col v-for="i in 6" :key="i" cols="12" sm="6" lg="4">
        <v-skeleton-loader type="card" />
      </v-col>
    </v-row>

    <!-- プロジェクト一覧 -->
    <v-row v-else-if="projectsStore.projects.length > 0">
      <v-col
        v-for="project in projectsStore.projects"
        :key="project.projectId"
        cols="12"
        sm="6"
        lg="4"
      >
        <v-card rounded="lg" hover height="100%">
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
              class="text-body-2 text-medium-emphasis mb-3"
              style="
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
              "
            >
              {{ project.description }}
            </p>
            <p v-else class="text-body-2 text-medium-emphasis mb-3">
              説明なし
            </p>

            <div class="d-flex align-center text-caption text-medium-emphasis">
              <v-icon size="14" class="mr-1">mdi-calendar</v-icon>
              作成日: {{ formatDate(project.createdAt) }}
              <v-spacer />
              <v-icon size="14" class="mr-1">mdi-account-group</v-icon>
              {{ memberCount(project) }} 人
            </div>
          </v-card-text>

          <v-card-actions>
            <!-- かんばんビューを開くボタン -->
            <v-btn
              color="primary"
              variant="tonal"
              size="small"
              prepend-icon="mdi-view-column"
              @click="goToBoard(project.projectId)"
            >
              かんばんを開く
            </v-btn>
            <v-spacer />
            <!-- メンバー管理 -->
            <v-btn
              icon="mdi-account-multiple-plus"
              variant="text"
              size="small"
              title="メンバーを管理する"
              @click.stop="openMembers(project)"
            />
            <!-- 編集ボタン -->
            <v-btn
              icon="mdi-pencil"
              variant="text"
              size="small"
              @click.stop="openEditForm(project)"
            />
            <!-- 削除ボタン -->
            <v-btn
              icon="mdi-delete"
              variant="text"
              size="small"
              color="error"
              @click.stop="openDeleteConfirm(project)"
            />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- プロジェクトが存在しない場合の空状態 -->
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

    <!-- プロジェクト作成・編集フォームダイアログ -->
    <ProjectForm
      v-model="showForm"
      :project="editingProject ?? undefined"
    />

    <!-- メンバー管理ダイアログ -->
    <ProjectMembersDialog
      v-model="showMembers"
      :project="membersProject ?? projectsStore.currentProject"
    />

    <!-- 削除確認ダイアログ -->
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
