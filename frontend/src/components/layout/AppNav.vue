<script setup lang="ts">
// トップナビゲーションバーコンポーネント
import { useRouter, useRoute } from 'vue-router'
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import ProfileDialog from '@/components/common/ProfileDialog.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const projectsStore = useProjectsStore()
const showProfile = ref(false)

// 現在のプロジェクト ID をルートパラメーターから取得する
const currentProjectId = computed(() => route.params.projectId as string | undefined)

// プロジェクト詳細ページかどうかを判定する
const isProjectPage = computed(() => !!currentProjectId.value)

// 現在のビューモードを判定する（かんばん / テーブル / ガント）
const currentView = computed(() => {
  if (route.name === 'task-board') return 'board'
  if (route.name === 'task-table') return 'table'
  if (route.name === 'task-timeline') return 'timeline'
  return null
})

/** かんばんビューに切り替える */
function switchToBoard() {
  if (currentProjectId.value) {
    router.push({ name: 'task-board', params: { projectId: currentProjectId.value } })
  }
}

/** テーブルビューに切り替える */
function switchToTable() {
  if (currentProjectId.value) {
    router.push({ name: 'task-table', params: { projectId: currentProjectId.value } })
  }
}

/** ガントビューに切り替える */
function switchToTimeline() {
  if (currentProjectId.value) {
    router.push({ name: 'task-timeline', params: { projectId: currentProjectId.value } })
  }
}

/** ログアウトする */
function handleLogout() {
  authStore.logout()
}

/** アバターは姓のみ */
const userInitials = computed(() => authStore.avatarLabel || '?')
</script>

<template>
  <v-app-bar elevation="1" color="surface">
    <!-- ロゴとアプリ名 -->
    <v-app-bar-title>
      <router-link to="/" class="text-decoration-none text-primary">
        <span class="font-weight-bold text-h6">TaskVista</span>
      </router-link>
    </v-app-bar-title>

    <!-- プロジェクトページのビュー切り替えタブ -->
    <template v-if="isProjectPage">
      <v-btn
        :variant="currentView === 'board' ? 'tonal' : 'text'"
        prepend-icon="mdi-view-column"
        :color="currentView === 'board' ? 'primary' : undefined"
        @click="switchToBoard"
      >
        かんばん
      </v-btn>
      <v-btn
        :variant="currentView === 'table' ? 'tonal' : 'text'"
        prepend-icon="mdi-table"
        :color="currentView === 'table' ? 'primary' : undefined"
        @click="switchToTable"
      >
        テーブル
      </v-btn>
      <v-btn
        :variant="currentView === 'timeline' ? 'tonal' : 'text'"
        prepend-icon="mdi-chart-gantt"
        :color="currentView === 'timeline' ? 'primary' : undefined"
        @click="switchToTimeline"
      >
        ガント
      </v-btn>
    </template>

    <v-spacer />

    <!-- ナビゲーションリンク -->
    <v-btn
      variant="text"
      prepend-icon="mdi-view-dashboard"
      :to="{ name: 'dashboard' }"
    >
      ダッシュボード
    </v-btn>
    <v-btn
      variant="text"
      prepend-icon="mdi-folder-multiple"
      :to="{ name: 'projects' }"
    >
      プロジェクト
    </v-btn>

    <!-- ユーザーアカウントメニュー -->
    <v-menu offset-y>
      <template #activator="{ props }">
        <v-avatar
          v-bind="props"
          color="primary"
          size="36"
          class="ml-2 mr-2 cursor-pointer"
          style="cursor: pointer"
        >
          <span class="text-caption font-weight-bold text-white">{{ userInitials }}</span>
        </v-avatar>
      </template>
      <v-list min-width="220">
        <v-list-item
          prepend-icon="mdi-account"
          :title="authStore.displayLabel"
          :subtitle="authStore.currentUser?.email || 'アカウント'"
        />
        <v-divider />
        <v-list-item
          prepend-icon="mdi-account-edit"
          title="表示名を設定"
          @click="showProfile = true"
        />
        <v-list-item
          prepend-icon="mdi-logout"
          title="ログアウト"
          @click="handleLogout"
        />
      </v-list>
    </v-menu>

    <ProfileDialog v-model="showProfile" />
  </v-app-bar>
</template>
