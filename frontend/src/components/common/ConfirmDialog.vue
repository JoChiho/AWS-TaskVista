<script setup lang="ts">
// 汎用確認ダイアログコンポーネント
defineProps<{
  title: string
  message: string
  confirmText?: string
  confirmColor?: string
  loading?: boolean
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const modelValue = defineModel<boolean>()
</script>

<template>
  <v-dialog v-model="modelValue" max-width="440" persistent>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        {{ title }}
      </v-card-title>
      <v-card-text class="px-5 text-body-2">
        {{ message }}
      </v-card-text>
      <v-card-actions class="px-5 pb-4">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="loading"
          @click="modelValue = false; emit('cancel')"
        >
          キャンセル
        </v-btn>
        <v-btn
          :color="confirmColor || 'primary'"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmText || '確認する' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
