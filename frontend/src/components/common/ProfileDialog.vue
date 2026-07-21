<script setup lang="ts">
// 表示名設定ダイアログ — 姓・名を分けてクラウド（DynamoDB）に保存
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { splitDisplayName } from '@/utils/displayName'

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

const familyNameInput = ref('')
const givenNameInput = ref('')
const isSaving = ref(false)
const errorMessage = ref('')

const familyRules = [
  (v: string) => !!v.trim() || '姓を入力してください',
  (v: string) => v.trim().length <= 50 || '50 文字以内で入力してください',
]
const givenRules = [
  (v: string) => !!v.trim() || '名を入力してください',
  (v: string) => v.trim().length <= 50 || '50 文字以内で入力してください',
]

watch(modelValue, (open) => {
  if (open) {
    if (authStore.familyName || authStore.givenName) {
      familyNameInput.value = authStore.familyName || ''
      givenNameInput.value = authStore.givenName || ''
    } else if (authStore.displayName) {
      const parts = splitDisplayName(authStore.displayName)
      familyNameInput.value = parts.familyName
      givenNameInput.value = parts.givenName
    } else {
      familyNameInput.value = ''
      givenNameInput.value = ''
    }
    errorMessage.value = ''
  }
})

async function handleSave() {
  const family = familyNameInput.value.trim()
  const given = givenNameInput.value.trim()
  if (!family || !given) return
  isSaving.value = true
  errorMessage.value = ''
  try {
    await authStore.setDisplayNameParts(family, given)
    uiStore.showSuccess('表示名を保存しました（すべての端末で共有されます）')
    modelValue.value = false
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message || '表示名の保存に失敗しました'
    errorMessage.value = msg
    uiStore.showError(msg)
  } finally {
    isSaving.value = false
  }
}

function handleCancel() {
  if (props.required) return
  modelValue.value = false
}
</script>

<template>
  <v-dialog
    v-model="modelValue"
    max-width="480"
    :persistent="required"
    :scrim="true"
  >
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        {{ required ? 'はじめに：表示名を設定してください' : '表示名を設定' }}
      </v-card-title>
      <v-card-text class="px-5">
        <p class="text-body-2 text-medium-emphasis mb-4">
          姓と名はクラウドに保存され、他のメンバーにも同一の表示名として表示されます。
          アバター（画面右上やカード）には姓のみが表示されます。
        </p>
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ errorMessage }}
        </v-alert>
        <v-row dense>
          <v-col cols="6">
            <v-text-field
              v-model="familyNameInput"
              label="姓 *"
              placeholder="例：徐"
              :rules="familyRules"
              counter="50"
              autofocus
              :disabled="isSaving"
              @keydown.enter.prevent="handleSave"
            />
          </v-col>
          <v-col cols="6">
            <v-text-field
              v-model="givenNameInput"
              label="名 *"
              placeholder="例：智甫"
              :rules="givenRules"
              counter="50"
              :disabled="isSaving"
              @keydown.enter.prevent="handleSave"
            />
          </v-col>
        </v-row>
        <div class="text-caption text-medium-emphasis mt-1">
          表示例: {{ familyNameInput.trim() || '姓' }} {{ givenNameInput.trim() || '名' }}
          ／ アバター: {{ familyNameInput.trim() || '姓' }}
        </div>
        <div class="text-caption text-medium-emphasis mt-2">
          ログイン中: {{ authStore.currentUser?.email || '—' }}
        </div>
      </v-card-text>
      <v-card-actions class="px-5 pb-4">
        <v-spacer />
        <v-btn v-if="!required" variant="text" :disabled="isSaving" @click="handleCancel">
          キャンセル
        </v-btn>
        <v-btn
          color="primary"
          :loading="isSaving"
          :disabled="!familyNameInput.trim() || !givenNameInput.trim()"
          @click="handleSave"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
