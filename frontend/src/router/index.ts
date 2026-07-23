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
      // タイムライン（ガント / カレンダー）ビュー
      path: '/projects/:projectId/timeline',
      name: 'task-timeline',
      component: () => import('@/views/TaskTimelineView.vue'),
      meta: { requiresAuth: true },
    },
    {
      // WBS 構成（マインドマップ型ツリー）
      path: '/projects/:projectId/wbs',
      name: 'task-wbs',
      component: () => import('@/views/TaskWbsView.vue'),
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

  // 毎回セッションを同期する（トークンだけでなく currentUser / 表示名も復元）
  // 以前は isAuthenticated のとき restore をスキップしており、
  // リフレッシュ後に currentUser が null のまま UI だけ消える不具合があった
  authStore.ensureSession()

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