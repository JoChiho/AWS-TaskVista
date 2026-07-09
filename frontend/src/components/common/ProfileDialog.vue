<script setup lang="ts">
// 表示名（ユーザー名）設定ダイアログ
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    /** true のときキャンセル不可（初回ログイン強制） */
    required?: boolean
  }>(),
  { required: false },
)

const modelValue = defineModel<boolean>()
const authStore = useAuthStore()
const uiStore = useUiStore()

const nameInput = ref('')

const nameRules = [
  (v: string) => !!v.trim() || '表示名（お名前）を入力してください',
  (v: string) => v.trim().length <= 100 || '100 文字以内で入力してください',
]

watch(modelValue, (open) => {
  if (open) {
    nameInput.value = authStore.displayName || ''
  }
})

function handleSave() {
  const trimmed = nameInput.value.trim()
  if (!trimmed) return
  authStore.setDisplayName(trimmed)
  uiStore.showSuccess('表示名を保存しました')
  modelValue.value = false
}

function handleCancel() {
  if (props.required) return
  modelValue.value = false
}
</script>

<template>
  <v-dialog
    v-model="modelValue"
    max-width="440"
    :persistent="required"
    :scrim="true"
  >
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        {{ required ? 'はじめに：表示名を設定してください' : '表示名を設定する' }}
      </v-card-title>
      <v-card-text class="px-5">
        <p class="text-body-2 text-medium-emphasis mb-4">
          プロジェクトのメンバー一覧やコメントに表示される<strong>お名前</strong>です。
          Cognito の自動生成 ID は使わず、分かりやすい氏名を設定してください。
        </p>
        <v-text-field
          v-model="nameInput"
          label="表示名（氏名）*"
          placeholder="例：徐 志富 / 鮫島"
          :rules="nameRules"
          counter="100"
          autofocus
          @keydown.enter.prevent="handleSave"
        />
        <div class="text-caption text-medium-emphasis">
          ログイン中: {{ authStore.currentUser?.email || '—' }}
        </div>
      </v-card-text>
      <v-card-actions class="px-5 pb-4">
        <v-spacer />
        <v-btn v-if="!required" variant="text" @click="handleCancel">キャンセル</v-btn>
        <v-btn color="primary" :disabled="!nameInput.trim()" @click="handleSave">
          保存して続ける
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
