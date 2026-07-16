<script setup lang="ts">
// ログインページコンポーネント
// Cognito Hosted UI へのリダイレクトを担当する
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
</script>

<template>
  <v-container
    class="fill-height d-flex align-center justify-center"
    fluid
  >
    <v-card
      class="pa-8 text-center"
      max-width="420"
      width="100%"
      elevation="4"
      rounded="xl"
    >
      <!-- アプリロゴとタイトル -->
      <v-icon size="64" color="primary" class="mb-4">mdi-check-circle-outline</v-icon>
      <h1 class="text-h4 font-weight-bold text-primary mb-2">TaskVista</h1>
      <p class="text-body-1 text-medium-emphasis mb-6">
        チームのタスクと進捗を一元管理する業務向けアプリケーションです
      </p>

      <v-divider class="mb-6" />

      <!-- 機能紹介 -->
      <v-row class="mb-6 text-left" dense>
        <v-col cols="12">
          <div class="d-flex align-center mb-3">
            <v-icon color="primary" class="mr-3">mdi-view-column</v-icon>
            <span class="text-body-2">かんばんビューによる進捗管理</span>
          </div>
          <div class="d-flex align-center mb-3">
            <v-icon color="primary" class="mr-3">mdi-table</v-icon>
            <span class="text-body-2">テーブルビューによる一覧確認</span>
          </div>
          <div class="d-flex align-center">
            <v-icon color="primary" class="mr-3">mdi-account-group</v-icon>
            <span class="text-body-2">チームメンバーへのタスク割当</span>
          </div>
        </v-col>
      </v-row>

      <!-- ログインボタン -->
      <v-btn
        block
        size="large"
        color="primary"
        prepend-icon="mdi-login"
        :loading="authStore.isLoading"
        @click="authStore.login"
      >
        サインイン
      </v-btn>

      <p class="text-caption text-medium-emphasis mt-4">
        Amazon Cognito により安全に認証されます
      </p>
    </v-card>
  </v-container>
</template>
