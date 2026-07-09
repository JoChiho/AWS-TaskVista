// アプリケーションのエントリポイント
import { createApp } from 'vue'
import { createPinia } from 'pinia'

// Vuetify のスタイルとコンポーネントを読み込む
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import App from './App.vue'
import router from './router'

// Vuetify テーマの設定（日本語チームワーク向けのカラーパレット）
const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          // メインカラー（インディゴ系）
          primary: '#3F51B5',
          // サブカラー（アンバー系）
          secondary: '#FF9800',
          // 成功・警告・エラー・情報の色
          success: '#4CAF50',
          warning: '#FFC107',
          error: '#F44336',
          info: '#2196F3',
          // 背景色
          background: '#F5F5F5',
          surface: '#FFFFFF',
        },
      },
    },
  },
  icons: {
    defaultSet: 'mdi',
  },
  // 日本語ロケール設定
  locale: {
    locale: 'ja',
  },
  defaults: {
    // デフォルトのバリアント設定
    VBtn: { variant: 'elevated' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VTextarea: { variant: 'outlined' },
  },
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(vuetify)

app.mount('#app')
