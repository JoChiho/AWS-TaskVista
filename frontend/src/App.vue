<script setup lang="ts">
// アプリケーションルートコンポーネント
import { RouterView, useRoute } from 'vue-router'
import { computed } from 'vue'
import { useUiStore } from '@/stores/ui'
import AppNav from '@/components/layout/AppNav.vue'

const uiStore = useUiStore()
const route = useRoute()

// ナビゲーションを非表示にするルート（ログイン、コールバック）
const hideNav = computed(() =>
  ['login', 'callback'].includes(route.name as string)
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
