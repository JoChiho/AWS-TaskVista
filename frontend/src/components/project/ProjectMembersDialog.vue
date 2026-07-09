<script setup lang="ts">
// プロジェクトメンバー管理ダイアログ
import { ref, watch, computed } from 'vue'
import type { Project, ProjectMember } from '@/types/project'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  project?: Project | null
}>()

const modelValue = defineModel<boolean>()
const projectsStore = useProjectsStore()
const authStore = useAuthStore()

const email = ref('')
const displayName = ref('')
const isSubmitting = ref(false)
const formError = ref('')

const emailRules = [
  (v: string) => !!v.trim() || 'メールアドレスは必須です',
  (v: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || '有効なメールアドレスを入力してください',
]

/** store 上の最新プロジェクトを優先する */
const liveProject = computed(() => {
  if (!props.project) return null
  const fromList = projectsStore.projects.find((p) => p.projectId === props.project!.projectId)
  if (fromList) return fromList
  if (projectsStore.currentProject?.projectId === props.project.projectId) {
    return projectsStore.currentProject
  }
  return props.project
})

/** 表示用メンバー（作成者を先頭・重複排除） */
const members = computed(() => {
  const project = liveProject.value
  if (!project) return [] as ProjectMember[]
  const list = [...(project.members ?? [])]
  // members が空の場合は memberIds から最低限表示
  if (list.length === 0 && project.memberIds?.length) {
    return project.memberIds.map((id) => ({
      userId: id,
      email: id === project.createdBy ? authStore.currentUser?.email || '' : '',
      displayName: id === project.createdBy ? authStore.displayLabel : id.slice(0, 8),
    }))
  }
  // 作成者を先頭に
  return list.sort((a, b) => {
    if (a.userId === project.createdBy) return -1
    if (b.userId === project.createdBy) return 1
    return (a.displayName || '').localeCompare(b.displayName || '', 'ja')
  })
})

const memberCountLabel = computed(() => `${members.value.length} 人`)

watch(modelValue, (open) => {
  if (open) {
    email.value = ''
    displayName.value = ''
    formError.value = ''
  }
})

async function handleAdd() {
  if (!liveProject.value || !email.value.trim()) return
  formError.value = ''
  isSubmitting.value = true
  try {
    await projectsStore.addMember(liveProject.value.projectId, {
      email: email.value.trim(),
      displayName: displayName.value.trim() || undefined,
    })
    email.value = ''
    displayName.value = ''
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message || 'メンバーの追加に失敗しました'
    formError.value = msg
  } finally {
    isSubmitting.value = false
  }
}

async function handleRemove(member: ProjectMember) {
  if (!liveProject.value) return
  // 削除キーは email を優先（API が email / userId 両対応）
  const key = member.email || member.userId
  if (!key) return
  isSubmitting.value = true
  formError.value = ''
  try {
    await projectsStore.removeMember(liveProject.value.projectId, key)
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message || 'メンバーの削除に失敗しました'
    formError.value = msg
  } finally {
    isSubmitting.value = false
  }
}

function isOwner(member: ProjectMember): boolean {
  return !!liveProject.value && member.userId === liveProject.value.createdBy
}

function canRemove(member: ProjectMember): boolean {
  return !isOwner(member)
}

function memberRowKey(member: ProjectMember): string {
  return member.userId || member.email || member.displayName
}
</script>

<template>
  <v-dialog v-model="modelValue" max-width="560" persistent scrollable>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5">
        プロジェクトメンバー
        <span class="text-body-2 text-medium-emphasis font-weight-regular ml-2">
          {{ liveProject?.name }}（{{ memberCountLabel }}）
        </span>
      </v-card-title>

      <v-divider />

      <v-card-text class="px-5 py-4">
        <p class="text-body-2 text-medium-emphasis mb-4">
          Cognito に登録済みのユーザーをメールアドレスで追加します。
          <strong>相手の確認は不要</strong>で、追加直後からプロジェクトを共有できます。
          作成者自身は追加・削除できません。
        </p>

        <v-alert v-if="formError" type="error" variant="tonal" density="compact" class="mb-3">
          {{ formError }}
        </v-alert>

        <!-- メンバー一覧 -->
        <v-list v-if="members.length > 0" class="mb-4 pa-0" density="comfortable">
          <v-list-item
            v-for="member in members"
            :key="memberRowKey(member)"
            class="px-2 mb-1"
            rounded="lg"
            border
          >
            <template #prepend>
              <v-avatar color="primary" size="36">
                <span class="text-caption text-white">
                  {{ (member.displayName || '?').slice(0, 2).toUpperCase() }}
                </span>
              </v-avatar>
            </template>
            <v-list-item-title class="text-body-2 font-weight-medium">
              {{ member.displayName || member.email }}
              <v-chip
                v-if="isOwner(member)"
                size="x-small"
                color="primary"
                variant="tonal"
                class="ml-2"
              >
                オーナー
              </v-chip>
              <v-chip
                v-else
                size="x-small"
                color="success"
                variant="tonal"
                class="ml-2"
              >
                メンバー
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              {{ member.email || '—' }}
            </v-list-item-subtitle>
            <template #append>
              <v-btn
                v-if="canRemove(member)"
                icon="mdi-account-remove"
                variant="text"
                size="small"
                color="error"
                :disabled="isSubmitting || projectsStore.isLoading"
                title="メンバーから外す"
                @click="handleRemove(member)"
              />
            </template>
          </v-list-item>
        </v-list>

        <v-alert
          v-else
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          メンバー情報がありません。下のフォームから追加してください。
        </v-alert>

        <v-divider class="mb-4" />

        <div class="text-subtitle-2 font-weight-bold mb-3">メンバーを追加する</div>
        <v-text-field
          v-model="email"
          label="メールアドレス *"
          placeholder="例：h-sameshima@findix.co.jp"
          :rules="emailRules"
          density="comfortable"
          class="mb-2"
          hide-details="auto"
        />
        <v-text-field
          v-model="displayName"
          label="表示名（任意）"
          placeholder="例：鮫島"
          density="comfortable"
          hide-details
          class="mb-2"
        />
        <div class="text-caption text-medium-emphasis mb-2">
          あなたの表示名: {{ authStore.displayLabel }}
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-5 py-3">
        <v-spacer />
        <v-btn variant="text" @click="modelValue = false">閉じる</v-btn>
        <v-btn
          color="primary"
          :loading="isSubmitting || projectsStore.isLoading"
          :disabled="!email.trim()"
          prepend-icon="mdi-account-plus"
          @click="handleAdd"
        >
          追加する
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
