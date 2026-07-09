// 認証状態管理ストア
// Cognito User Pool の JWT トークン管理と認証フローを担当する
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'

/** 認証済みユーザーの情報 */
interface AuthUser {
  sub: string
  email: string
  /** Cognito クレーム由来の名前（UUID っぽい場合がある） */
  name?: string
  picture?: string
}

const DISPLAY_NAME_PREFIX = 'taskvista.displayName.'

function isUglyCognitoUsername(value?: string): boolean {
  if (!value) return true
  // Cognito 自動生成ユーザー名や UUID 形式は表示に向かない
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_?/i.test(value)) {
    return true
  }
  // 長いランダム文字列
  if (/^[a-z0-9_-]{20,}$/i.test(value) && !value.includes('@') && !/[\u3040-\u30ff\u4e00-\u9faf]/.test(value)) {
    return true
  }
  return false
}

export const useAuthStore = defineStore('auth', () => {
  // アクセストークン（メモリに保存、ページリフレッシュで消える）
  const accessToken = ref<string | null>(sessionStorage.getItem('accessToken'))
  // ID トークン（ユーザー情報を含む）
  const idToken = ref<string | null>(sessionStorage.getItem('idToken'))
  // 現在のユーザー情報
  const currentUser = ref<AuthUser | null>(null)
  // ユーザーが設定した表示名
  const displayName = ref<string>('')
  // ローディング状態
  const isLoading = ref(false)

  /** 認証済みかどうかを返す計算プロパティ */
  const isAuthenticated = computed(() => !!accessToken.value || !!idToken.value)

  /**
   * ユーザーが明示的に表示名を設定済みか
   * （未設定の場合は初回ログイン時に設定を促す）
   */
  const hasCustomDisplayName = computed(() => !!displayName.value.trim())

  /**
   * 画面表示用の名前
   * 優先順位: ユーザー設定の表示名 > きれいな Cognito name > メールローカル部 > メール全体
   */
  const displayLabel = computed(() => {
    if (displayName.value.trim()) return displayName.value.trim()
    const user = currentUser.value
    if (!user) return 'ユーザー'
    if (user.name && !isUglyCognitoUsername(user.name)) return user.name
    if (user.email) {
      const local = user.email.split('@')[0]
      return local || user.email
    }
    return 'ユーザー'
  })

  function loadDisplayName(sub: string): void {
    const stored = localStorage.getItem(DISPLAY_NAME_PREFIX + sub)
    displayName.value = stored ?? ''
  }

  /**
   * 表示名を保存する（端末の localStorage）
   */
  function setDisplayName(name: string): void {
    const trimmed = name.trim()
    displayName.value = trimmed
    const sub = currentUser.value?.sub
    if (!sub) return
    if (trimmed) {
      localStorage.setItem(DISPLAY_NAME_PREFIX + sub, trimmed)
    } else {
      localStorage.removeItem(DISPLAY_NAME_PREFIX + sub)
    }
  }

  /**
   * Cognito Hosted UI へのログイン URL を構築する
   * OAuth 2.0 Authorization Code Flow を使用する
   */
  function buildLoginUrl(): string {
    const domain = import.meta.env.VITE_COGNITO_DOMAIN
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
    const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid email profile',
    })

    return `${domain}/oauth2/authorize?${params.toString()}`
  }

  /**
   * Cognito Hosted UI にリダイレクトしてログインを開始する
   */
  function login(): void {
    window.location.href = buildLoginUrl()
  }

  /**
   * 認証コードをトークンに交換する（コールバック処理）
   * @param code Cognito から受け取った認証コード
   */
  async function handleCallback(code: string): Promise<void> {
    isLoading.value = true

    try {
      const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
      const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
      const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI

      // 認証コードをアクセストークンに交換する
      const response = await axios.post(
        `${cognitoDomain}/oauth2/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      )

      const {
        access_token,
        id_token,
        refresh_token,
      } = response.data as {
        access_token: string
        id_token: string
        refresh_token?: string
      }

      // アクセストークンと ID トークンはメモリ（sessionStorage）に保存する
      accessToken.value = access_token
      idToken.value = id_token
      sessionStorage.setItem('accessToken', access_token)
      sessionStorage.setItem('idToken', id_token)

      // リフレッシュトークンは localStorage に保存する（ページリフレッシュ後も有効）
      if (refresh_token) {
        localStorage.setItem('refreshToken', refresh_token)
      }

      // ID トークンからユーザー情報を取得する
      if (id_token) parseUserFromIdToken(id_token)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * ID トークン（JWT）からユーザー情報を取得する
   * @param token ID トークン文字列
   */
  function parseUserFromIdToken(token: string): void {
    try {
      // JWT のペイロード部分をデコードする（Base64URL → JSON）
      const payloadPart = token.split('.')[1]
      if (!payloadPart) return
      const payload = JSON.parse(atob(payloadPart))
      currentUser.value = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name || payload['cognito:username'],
        picture: payload.picture,
      }
      if (payload.sub) loadDisplayName(payload.sub)
    } catch {
      // トークンの解析に失敗した場合は無視する
      currentUser.value = null
    }
  }

  /**
   * ログアウト処理
   * すべてのトークンを削除してログインページへリダイレクトする
   */
  function logout(): void {
    // ストア内のトークンをクリアする
    accessToken.value = null
    idToken.value = null
    currentUser.value = null
    displayName.value = ''

    // ストレージからもトークンを削除する
    sessionStorage.removeItem('accessToken')
    sessionStorage.removeItem('idToken')
    localStorage.removeItem('refreshToken')

    // Cognito からもサインアウトする
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
    const redirectUri = window.location.origin + '/login'

    window.location.href =
      `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(redirectUri)}`
  }

  /**
   * ページロード時にセッションストレージからトークンを復元する
   */
  function restoreSession(): void {
    const storedAccessToken = sessionStorage.getItem('accessToken')
    const storedIdToken = sessionStorage.getItem('idToken')

    if (storedAccessToken && storedIdToken) {
      accessToken.value = storedAccessToken
      idToken.value = storedIdToken
      parseUserFromIdToken(storedIdToken)
    }
  }

  return {
    accessToken,
    idToken,
    currentUser,
    displayName,
    displayLabel,
    hasCustomDisplayName,
    isLoading,
    isAuthenticated,
    login,
    logout,
    handleCallback,
    restoreSession,
    setDisplayName,
  }
})
