// ルーター設定
// 認証ガードで未認証ユーザーをログインページへリダイレクトする
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  // History モード（CloudFront のカスタムエラー設定が必要）
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { requiresAuth: false },
    },
    {
      // Cognito OAuth 2.0 コールバック処理
      path: '/callback',
      name: 'callback',
      component: () => import('@/views/CallbackView.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // プロジェクト一覧
      path: '/projects',
      name: 'projects',
      component: () => import('@/views/ProjectListView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // かんばんビュー
      path: '/projects/:projectId/board',
      name: 'task-board',
      component: () => import('@/views/TaskBoardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // テーブルビュー
      path: '/projects/:projectId/table',
      name: 'task-table',
      component: () => import('@/views/TaskTableView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // 存在しないページへのフォールバック
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

/**
 * グローバルナビゲーションガード
 * 認証が必要なルートでトークンの有無を確認する
 */
router.beforeEach((to) => {
  const authStore = useAuthStore()

  // セッションストレージからトークンを復元する（ページリフレッシュ対応）
  if (!authStore.isAuthenticated) {
    authStore.restoreSession()
  }

  // 認証が必要なルートで未認証の場合はログインページへリダイレクトする
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  // すでに認証済みでログインページにアクセスした場合はホームへリダイレクトする
  if (to.name === 'login' && authStore.isAuthenticated) {
    return { name: 'dashboard' }
  }
})

export default router