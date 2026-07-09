<script setup lang="ts">
// Cognito OAuth 2.0 コールバック処理ページ
// 認証コードをトークンに交換してダッシュボードへリダイレクトする
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const router = useRouter()
const authStore = useAuthStore()
const uiStore = useUiStore()

onMounted(async () => {
  // URL のクエリパラメーターから認証コードを取得する
  const urlParams = new URLSearchParams(window.location.search)
  const code = urlParams.get('code')
  const error = urlParams.get('error')

  if (error) {
    // 認証エラーの場合はログインページへ戻る
    uiStore.showError('認証に失敗しました。もう一度お試しください')
    router.replace({ name: 'login' })
    return
  }

  if (!code) {
    // 認証コードがない場合はログインページへ戻る
    router.replace({ name: 'login' })
    return
  }

  try {
    // 認証コードをトークンに交換する
    await authStore.handleCallback(code)
    // 認証成功後はダッシュボードへ遷移する
    router.replace({ name: 'dashboard' })
  } catch {
    uiStore.showError('ログインの処理中にエラーが発生しました')
    router.replace({ name: 'login' })
  }
})
</script>

<template>
  <!-- 認証処理中のローディング画面 -->
  <v-container class="fill-height d-flex align-center justify-center" fluid>
    <div class="text-center">
      <v-progress-circular
        indeterminate
        size="64"
        color="primary"
        class="mb-4"
      />
      <p class="text-body-1 text-medium-emphasis">認証情報を確認しています...</p>
    </div>
  </v-container>
</template>
