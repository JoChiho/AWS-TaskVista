// Axios HTTP クライアントの設定
// JWT トークンの自動注入とトークン自動リフレッシュを担当する
import axios, { type AxiosInstance, type InternalAxiosRequestConfig, type AxiosResponse } from 'axios'
import { v4 as uuidv4 } from 'uuid'

// Axios インスタンスの作成（ベース URL は環境変数から取得）
const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * リクエストインターセプター
 * - Bearer トークンを Authorization ヘッダーに注入する
 * - X-Correlation-Id ヘッダーを生成して注入する（ログ追跡用）
 */
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // メモリからアクセストークンを取得する
    const token = sessionStorage.getItem('accessToken')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }

    // リクエストごとに一意の CorrelationId を生成する
    config.headers['X-Correlation-Id'] = uuidv4()

    return config
  },
  (error) => {
    return Promise.reject(error)
  },
)

/**
 * レスポンスインターセプター
 * - 401 エラーを捕捉し、リフレッシュトークンで再認証を試みる
 * - リフレッシュに失敗した場合はログインページへリダイレクトする
 */
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config

    // 401 エラーかつ、リトライ済みでない場合にトークンリフレッシュを試みる
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        // リフレッシュトークンで新しいアクセストークンを取得する
        const refreshToken = localStorage.getItem('refreshToken')
        if (!refreshToken) {
          throw new Error('リフレッシュトークンが存在しません')
        }

        const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN
        const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID

        const tokenResponse = await axios.post(
          `${cognitoDomain}/oauth2/token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: refreshToken,
          }),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          },
        )

        const { access_token, id_token } = tokenResponse.data as {
          access_token: string
          id_token: string
        }

        // 新しいトークンを保存する
        sessionStorage.setItem('accessToken', access_token)
        sessionStorage.setItem('idToken', id_token)

        // 元のリクエストを新しいトークンで再試行する
        originalRequest.headers.Authorization = `Bearer ${access_token}`
        return apiClient(originalRequest)
      } catch (refreshError) {
        // リフレッシュに失敗した場合、セッション情報を削除してログインページへ遷移する
        sessionStorage.removeItem('accessToken')
        sessionStorage.removeItem('idToken')
        localStorage.removeItem('refreshToken')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  },
)

export default apiClient