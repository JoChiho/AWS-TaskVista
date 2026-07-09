// 認証状態管理ストア
// Cognito JWT + クラウド上の表示名プロフィール（TaskVista-Users）
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import * as usersApi from '@/api/users'

/** 認証済みユーザーの情報 */
interface AuthUser {
  sub: string
  email: string
  /** Cognito クレーム由来の名前（UUID っぽい場合がある） */
  name?: string
  picture?: string
}

function isUglyCognitoUsername(value?: string): boolean {
  if (!value) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return true
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_?/i.test(value)) {
    return true
  }
  if (
    /^[a-z0-9_-]{20,}$/i.test(value) &&
    !value.includes('@') &&
    !/[\u3040-\u30ff\u4e00-\u9faf]/.test(value)
  ) {
    return true
  }
  return false
}

/** JWT payload を Base64URL 対応でデコードする */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1]
  if (!payloadPart) throw new Error('invalid jwt')
  let base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4
  if (pad) base64 += '='.repeat(4 - pad)
  const binary = atob(base64)
  // UTF-8 対応
  const json = decodeURIComponent(
    Array.from(binary)
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  )
  return JSON.parse(json) as Record<string, unknown>
}

export const useAuthStore = defineStore('auth', () => {
  // 初期化時は sessionStorage から読むが、currentUser は ensureSession で必ず復元する
  const accessToken = ref<string | null>(null)
  const idToken = ref<string | null>(null)
  const currentUser = ref<AuthUser | null>(null)
  /** クラウドから読み込んだ表示名 */
  const displayName = ref<string>('')
  /** GET /me 完了後 true（未設定判定に使う） */
  const profileLoaded = ref(false)
  const isLoading = ref(false)
  /** プロフィール取得の重複防止 */
  let profileLoading: Promise<void> | null = null

  const isAuthenticated = computed(() => !!accessToken.value || !!idToken.value)

  /** クラウドに表示名が保存済みか（初回のみ設定を促す） */
  const hasCustomDisplayName = computed(() => !!displayName.value.trim())

  /**
   * 画面表示用の名前
   * 優先: クラウド表示名 > きれいな Cognito name > メール
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

  function login(): void {
    window.location.href = buildLoginUrl()
  }

  async function handleCallback(code: string): Promise<void> {
    isLoading.value = true
    try {
      const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
      const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
      const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI

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

      accessToken.value = access_token
      idToken.value = id_token
      sessionStorage.setItem('accessToken', access_token)
      sessionStorage.setItem('idToken', id_token)

      if (refresh_token) {
        localStorage.setItem('refreshToken', refresh_token)
      }

      if (id_token) parseUserFromIdToken(id_token)
      await loadCloudProfile()
    } finally {
      isLoading.value = false
    }
  }

  function parseUserFromIdToken(token: string): void {
    try {
      const payload = decodeJwtPayload(token)
      const sub = String(payload.sub || '')
      if (!sub) {
        currentUser.value = null
        return
      }
      currentUser.value = {
        sub,
        email: String(payload.email || ''),
        name: String(
          payload.name || payload['cognito:username'] || payload.preferred_username || '',
        ),
        picture: payload.picture ? String(payload.picture) : undefined,
      }
    } catch (e) {
      console.error('ID トークンの解析に失敗:', e)
      currentUser.value = null
    }
  }

  /**
   * クラウドから表示名を読み込む
   */
  async function loadCloudProfile(): Promise<void> {
    if (!accessToken.value && !idToken.value) {
      profileLoaded.value = false
      return
    }
    if (profileLoading) return profileLoading

    profileLoading = (async () => {
      try {
        const profile = await usersApi.fetchMyProfile()
        displayName.value = profile.displayName?.trim() || ''
        profileLoaded.value = true
      } catch (e) {
        console.error('プロフィール取得エラー:', e)
        displayName.value = ''
        profileLoaded.value = true
      } finally {
        profileLoading = null
      }
    })()

    return profileLoading
  }

  /**
   * 表示名をクラウドに保存する
   */
  async function setDisplayName(name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const profile = await usersApi.updateMyProfile(trimmed)
    displayName.value = profile.displayName?.trim() || trimmed
    profileLoaded.value = true
  }

  function logout(): void {
    accessToken.value = null
    idToken.value = null
    currentUser.value = null
    displayName.value = ''
    profileLoaded.value = false
    profileLoading = null

    sessionStorage.removeItem('accessToken')
    sessionStorage.removeItem('idToken')
    localStorage.removeItem('refreshToken')

    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID
    const redirectUri = window.location.origin + '/login'

    window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(redirectUri)}`
  }

  /**
   * セッション復元（ページリフレッシュ対応）
   * トークンがあっても currentUser が null の場合があるため、毎回確実にパースする
   */
  function ensureSession(): void {
    const storedAccess = sessionStorage.getItem('accessToken')
    const storedId = sessionStorage.getItem('idToken')

    if (storedAccess) accessToken.value = storedAccess
    if (storedId) idToken.value = storedId

    // トークンがあるのにユーザー情報が無い → JWT を再パース（リフレッシュ時の主因）
    if (idToken.value && !currentUser.value) {
      parseUserFromIdToken(idToken.value)
    }

    // プロフィール未取得ならクラウドから読む
    if ((accessToken.value || idToken.value) && !profileLoaded.value && !profileLoading) {
      void loadCloudProfile()
    }
  }

  /** @deprecated ensureSession を使用 */
  function restoreSession(): void {
    ensureSession()
  }

  // Pinia 初期化直後にも一度復元する（ルーターガードより前に currentUser を埋める）
  ensureSession()

  return {
    accessToken,
    idToken,
    currentUser,
    displayName,
    displayLabel,
    hasCustomDisplayName,
    profileLoaded,
    isLoading,
    isAuthenticated,
    login,
    logout,
    handleCallback,
    restoreSession,
    ensureSession,
    setDisplayName,
    loadCloudProfile,
  }
})
