<script setup lang="ts">
// アプリケーションルートコンポーネント
import { RouterView, useRoute } from 'vue-router'
import { computed, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import AppNav from '@/components/layout/AppNav.vue'
import ProfileDialog from '@/components/common/ProfileDialog.vue'

const uiStore = useUiStore()
const authStore = useAuthStore()
const route = useRoute()

// ナビゲーションを非表示にするルート（ログイン、コールバック）
const hideNav = computed(() =>
  ['login', 'callback'].includes(route.name as string),
)

/** 初回ログイン時：表示名未設定なら強制ダイアログ */
const forceProfile = ref(false)

watch(
  () => [authStore.isAuthenticated, authStore.hasCustomDisplayName, route.name] as const,
  ([authed, hasName, name]) => {
    if (!authed) {
      forceProfile.value = false
      return
    }
    if (name === 'login' || name === 'callback') {
      forceProfile.value = false
      return
    }
    forceProfile.value = !hasName
  },
  { immediate: true },
)
</script>

<template>
  <!-- Vuetify のルートコンポーネント -->
  <v-app>
    <!-- 認証ページ以外でナビゲーションを表示する -->
    <AppNav v-if="!hideNav" />

    <!-- ページコンテンツ -->
    <v-main>
      <RouterView />
    </v-main>

    <!-- 初回表示名の強制設定（キャンセル不可） -->
    <ProfileDialog v-model="forceProfile" :required="true" />

    <!-- グローバルスナックバー通知 -->
    <v-snackbar
      v-model="uiStore.snackbar.visible"
      :color="uiStore.snackbar.color"
      :timeout="uiStore.snackbar.timeout"
      location="bottom right"
      rounded="lg"
    >
      {{ uiStore.snackbar.message }}
      <template #actions>
        <v-btn
          variant="text"
          icon="mdi-close"
          @click="uiStore.hideSnackbar"
        />
      </template>
    </v-snackbar>

    <!-- グローバルローディングオーバーレイ -->
    <v-overlay
      v-model="uiStore.isGlobalLoading"
      class="align-center justify-center"
      persistent
    >
      <v-progress-circular indeterminate size="64" color="primary" />
    </v-overlay>
  </v-app>
</template>
