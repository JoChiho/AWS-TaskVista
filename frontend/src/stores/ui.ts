// グローバル UI 状態管理ストア
// スナックバー通知とグローバルローディング状態を管理する
import { defineStore } from 'pinia'
import { ref } from 'vue'

/** スナックバーの色タイプ */
type SnackbarColor = 'success' | 'error' | 'warning' | 'info'

/** スナックバーの状態 */
interface SnackbarState {
  visible: boolean
  message: string
  color: SnackbarColor
  timeout: number
}

export const useUiStore = defineStore('ui', () => {
  // スナックバーの状態
  const snackbar = ref<SnackbarState>({
    visible: false,
    message: '',
    color: 'info',
    timeout: 4000,
  })

  // グローバルローディング状態
  const isGlobalLoading = ref(false)

  /**
   * スナックバーを表示する共通関数
   * @param message 表示するメッセージ
   * @param color スナックバーの色
   * @param timeout 表示時間（ミリ秒）
   */
  function showSnackbar(message: string, color: SnackbarColor, timeout = 4000): void {
    snackbar.value = {
      visible: true,
      message,
      color,
      timeout,
    }
  }

  /** 成功メッセージを表示する */
  function showSuccess(message: string): void {
    showSnackbar(message, 'success')
  }

  /** エラーメッセージを表示する */
  function showError(message: string): void {
    showSnackbar(message, 'error', 6000)
  }

  /** 警告メッセージを表示する */
  function showWarning(message: string): void {
    showSnackbar(message, 'warning')
  }

  /** 情報メッセージを表示する */
  function showInfo(message: string): void {
    showSnackbar(message, 'info')
  }

  /** スナックバーを非表示にする */
  function hideSnackbar(): void {
    snackbar.value.visible = false
  }

  /** グローバルローディングを表示する */
  function startLoading(): void {
    isGlobalLoading.value = true
  }

  /** グローバルローディングを非表示にする */
  function stopLoading(): void {
    isGlobalLoading.value = false
  }

  return {
    snackbar,
    isGlobalLoading,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    hideSnackbar,
    startLoading,
    stopLoading,
  }
})
