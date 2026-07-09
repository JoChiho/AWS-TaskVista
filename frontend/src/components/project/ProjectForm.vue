<script setup lang="ts">
// プロジェクト作成・編集フォームコンポーネント
import { ref, watch } from 'vue'
import type { Project } from '@/types/project'
import { useProjectsStore } from '@/stores/projects'

const props = defineProps<{
  project?: Project
}>()

const emit = defineEmits<{
  saved: [project: Project]
}>()

const modelValue = defineModel<boolean>()
const projectsStore = useProjectsStore()

// フォームの入力値
const name = ref('')
const description = ref('')

// フォームバリデーションルール
const nameRules = [
  (v: string) => !!v || 'プロジェクト名は必須項目です',
  (v: string) => v.length <= 100 || 'プロジェクト名は 100 文字以内で入力してください',
]

// ダイアログが開かれるたびにフォームを初期化する
watch(modelValue, (isOpen) => {
  if (isOpen) {
    name.value = props.project?.name ?? ''
    description.value = props.project?.description ?? ''
  }
})

/** フォームを送信する（作成 or 更新） */
async function handleSubmit() {
  if (!name.value.trim()) return

  let saved: Project
  if (props.project) {
    // 既存プロジェクトの更新
    saved = await projectsStore.updateProject(props.project.projectId, {
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    })
  } else {
    // 新しいプロジェクトの作成
    saved = await projectsStore.createProject({
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    })
  }

  emit('saved', saved)
  modelValue.value = false
}

/** ダイアログを閉じる */
function handleCancel() {
  modelValue.value = false
}

// 編集モードかどうかを判定する
const isEditMode = !!props.project
</script>

<template>
  <v-dialog v-model="modelValue" max-width="520" persistent>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        {{ isEditMode ? 'プロジェクトを編集する' : '新しいプロジェクトを作成する' }}
      </v-card-title>

      <v-card-text class="px-5">
        <v-form @submit.prevent="handleSubmit">
          <!-- プロジェクト名 -->
          <v-text-field
            v-model="name"
            label="プロジェクト名 *"
            :rules="nameRules"
            placeholder="例：TaskVista 開発プロジェクト"
            class="mb-3"
            counter="100"
            autofocus
          />
          <!-- 説明（任意） -->
          <v-textarea
            v-model="description"
            label="説明（任意）"
            placeholder="プロジェクトの目的や概要を入力してください"
            rows="3"
            counter="1000"
          />
        </v-form>
      </v-card-text>

      <v-card-actions class="px-5 pb-4">
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="projectsStore.isLoading"
          @click="handleCancel"
        >
          キャンセル
        </v-btn>
        <v-btn
          color="primary"
          :loading="projectsStore.isLoading"
          :disabled="!name.trim()"
          @click="handleSubmit"
        >
          保存する
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
