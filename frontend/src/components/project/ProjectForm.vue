<script setup lang="ts">
// プロジェクト作成・編集フォーム
// 名前・説明に加え、メンバー追加も同一ダイアログで行う
import { ref, watch, computed } from 'vue'
import type { Project, ProjectMember, ProjectStatus } from '@/types/project'
import { PROJECT_STATUS_OPTIONS } from '@/types/project'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'
import { resolveMemberDisplayName, avatarLabelFromName } from '@/utils/displayName'

const props = defineProps<{
  /** 編集時のみ渡す。未指定 / null なら新規作成 */
  project?: Project | null
}>()

const emit = defineEmits<{
  saved: [project: Project]
}>()

const modelValue = defineModel<boolean>({ default: false })
const projectsStore = useProjectsStore()
const authStore = useAuthStore()

const name = ref('')
const description = ref('')
const status = ref<ProjectStatus>('active')
const formError = ref('')

/** メンバー追加用メール入力 */
const memberEmailInput = ref('')
const memberError = ref('')
const isAddingMember = ref(false)

/**
 * 新規作成時: 保存前に溜めておく招待メール
 * （プロジェクト ID が無い間は API 追加できない）
 */
const pendingInviteEmails = ref<string[]>([])

const nameRules = [
  (v: string) => !!v?.trim() || 'プロジェクト名は必須項目です',
  (v: string) =>
    (v?.trim().length ?? 0) <= 100 || 'プロジェクト名は 100 文字以内で入力してください',
]

const emailRules = [
  (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || '有効なメールアドレスを入力してください',
]

const isEditMode = computed(() => !!props.project?.projectId)

const dialogTitle = computed(() =>
  isEditMode.value ? 'プロジェクトを編集' : '新規プロジェクト',
)

const submitLabel = computed(() =>
  isEditMode.value ? '保存' : '作成',
)

const statusOptions = PROJECT_STATUS_OPTIONS

/** 編集中プロジェクトの最新データ（メンバー追加後も store と同期） */
const liveProject = computed((): Project | null => {
  if (!props.project?.projectId) return null
  const id = props.project.projectId
  if (projectsStore.currentProject?.projectId === id) {
    return projectsStore.currentProject
  }
  return projectsStore.projects.find((p) => p.projectId === id) || props.project
})

const isCurrentUserOwner = computed(() => {
  if (!isEditMode.value) return true // 作成者は作成後オーナー
  const p = liveProject.value
  const sub = authStore.currentUser?.sub
  return !!(p && sub && p.createdBy === sub)
})

/** 編集時: 既存メンバー一覧 */
const existingMembers = computed((): ProjectMember[] => {
  const p = liveProject.value
  if (!p) return []
  const list = [...(p.members ?? [])]
  if (list.length === 0 && p.memberIds?.length) {
    return p.memberIds.map((id) => ({
      userId: id,
      email: id === authStore.currentUser?.sub ? authStore.currentUser?.email || '' : '',
      displayName:
        id === authStore.currentUser?.sub ? authStore.displayLabel : id.slice(0, 8),
    }))
  }
  return list.sort((a, b) => {
    if (a.userId === p.createdBy) return -1
    if (b.userId === p.createdBy) return 1
    return resolveMemberDisplayName(a).localeCompare(resolveMemberDisplayName(b), 'ja')
  })
})

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function initForm() {
  formError.value = ''
  memberError.value = ''
  memberEmailInput.value = ''
  pendingInviteEmails.value = []

  if (props.project?.projectId) {
    name.value = props.project.name ?? ''
    description.value = props.project.description ?? ''
    status.value = props.project.status ?? 'active'
    try {
      await projectsStore.ensureProject(props.project.projectId)
    } catch {
      // 一覧の情報で継続
    }
  } else {
    name.value = ''
    description.value = ''
    status.value = 'active'
  }
}

watch(
  () => [modelValue.value, props.project?.projectId, props.project?.updatedAt] as const,
  ([isOpen]) => {
    if (isOpen) void initForm()
  },
)

/** メンバーをリストに追加（新規: 保留 / 編集: 即 API） */
async function handleAddMember() {
  const email = normalizeEmail(memberEmailInput.value)
  memberError.value = ''
  if (!email) {
    memberError.value = 'メールアドレスを入力してください'
    return
  }
  if (!isValidEmail(email)) {
    memberError.value = '有効なメールアドレスを入力してください'
    return
  }
  if (authStore.currentUser?.email && normalizeEmail(authStore.currentUser.email) === email) {
    memberError.value = '自分自身は追加できません'
    return
  }

  if (isEditMode.value) {
    if (!isCurrentUserOwner.value) {
      memberError.value = 'メンバーの追加はオーナーのみ可能です'
      return
    }
    const p = liveProject.value
    if (!p) return
    // 既にいるか
    const exists = existingMembers.value.some(
      (m) => normalizeEmail(m.email || '') === email,
    )
    if (exists) {
      memberError.value = 'このユーザーは既にメンバーです'
      return
    }
    isAddingMember.value = true
    try {
      await projectsStore.addMember(p.projectId, { email })
      memberEmailInput.value = ''
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data
          ?.error?.message || 'メンバーの追加に失敗しました'
      memberError.value = msg
    } finally {
      isAddingMember.value = false
    }
    return
  }

  // 新規作成: 保留リストへ
  if (pendingInviteEmails.value.includes(email)) {
    memberError.value = 'すでに追加リストに含まれています'
    return
  }
  pendingInviteEmails.value = [...pendingInviteEmails.value, email]
  memberEmailInput.value = ''
}

function removePendingInvite(email: string) {
  pendingInviteEmails.value = pendingInviteEmails.value.filter((e) => e !== email)
}

async function handleRemoveMember(member: ProjectMember) {
  const p = liveProject.value
  if (!p || !isCurrentUserOwner.value) return
  if (member.userId === p.createdBy) return
  const key = member.email || member.userId
  if (!key) return
  isAddingMember.value = true
  memberError.value = ''
  try {
    await projectsStore.removeMember(p.projectId, key)
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message || 'メンバーの削除に失敗しました'
    memberError.value = msg
  } finally {
    isAddingMember.value = false
  }
}

async function handleSubmit() {
  const trimmedName = name.value.trim()
  if (!trimmedName) return
  formError.value = ''
  memberError.value = ''

  try {
    let saved: Project
    if (props.project?.projectId) {
      saved = await projectsStore.updateProject(props.project.projectId, {
        name: trimmedName,
        description: description.value.trim() || undefined,
        status: status.value,
      })
    } else {
      saved = await projectsStore.createProject({
        name: trimmedName,
        description: description.value.trim() || undefined,
        status: status.value,
      })
      // 作成後に保留していたメンバーを招待
      const failed: string[] = []
      for (const email of pendingInviteEmails.value) {
        try {
          await projectsStore.addMember(saved.projectId, { email })
        } catch {
          failed.push(email)
        }
      }
      if (failed.length > 0) {
        formError.value = `プロジェクトは作成されましたが、次の招待に失敗しました: ${failed.join(', ')}`
        // ダイアログは閉じず、編集対象を作成済みプロジェクトに切り替え相当の UX
        // 親に saved を渡し、ユーザーが再試行できるように閉じない
        emit('saved', saved)
        pendingInviteEmails.value = failed
        return
      }
    }
    emit('saved', saved)
    modelValue.value = false
  } catch (e: unknown) {
    const msg =
      (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message || (isEditMode.value ? '更新に失敗しました' : '作成に失敗しました')
    formError.value = msg
  }
}

function handleCancel() {
  modelValue.value = false
}

function canRemoveMember(member: ProjectMember): boolean {
  if (!isEditMode.value || !isCurrentUserOwner.value) return false
  const p = liveProject.value
  if (!p) return false
  return member.userId !== p.createdBy
}
</script>

<template>
  <v-dialog v-model="modelValue" max-width="600" persistent scrollable>
    <v-card rounded="lg">
      <v-card-title class="text-subtitle-1 font-weight-bold pt-5 px-5 d-flex align-center">
        <v-icon class="mr-2" color="primary">
          {{ isEditMode ? 'mdi-pencil' : 'mdi-folder-plus' }}
        </v-icon>
        <span>{{ dialogTitle }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          :disabled="projectsStore.isLoading || isAddingMember"
          @click="handleCancel"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="px-5 py-4">
        <v-alert
          v-if="isEditMode && project"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          border="start"
        >
          <div class="text-body-2">
            <strong>{{ project.name }}</strong>
            を編集しています
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            作成日: {{ formatDate(project.createdAt) }}
          </div>
        </v-alert>

        <v-alert
          v-else
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          border="start"
        >
          <div class="text-body-2">
            名前と説明を入力し、必要ならメンバーも追加してから作成できます。
          </div>
        </v-alert>

        <v-alert
          v-if="formError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ formError }}
        </v-alert>

        <!-- 基本情報 -->
        <p class="text-subtitle-2 font-weight-bold mb-2">基本情報</p>

        <p class="text-caption text-medium-emphasis mb-1">プロジェクト名 *</p>
        <v-text-field
          v-model="name"
          :rules="nameRules"
          placeholder="例：TaskVista 開発 / 鮫島PJ"
          counter="100"
          hide-details="auto"
          autofocus
          density="comfortable"
          class="mb-3"
        />

        <p class="text-caption text-medium-emphasis mb-1">説明（任意）</p>
        <v-textarea
          v-model="description"
          placeholder="目的や概要（任意）"
          rows="3"
          counter="1000"
          hide-details="auto"
          density="comfortable"
          class="mb-3"
        />

        <div class="mb-4">
          <p class="text-caption text-medium-emphasis mb-1">ステータス</p>
          <v-select
            v-model="status"
            :items="statusOptions"
            item-title="title"
            item-value="value"
            hide-details
            density="comfortable"
          />
          <p class="text-caption text-medium-emphasis mt-2 mb-0">
            計画中 → 進行中 → 完了 / 保留 / アーカイブ など、段階に合わせて選択できます。
          </p>
        </div>

        <v-divider class="mb-4" />

        <!-- メンバー -->
        <p class="text-subtitle-2 font-weight-bold mb-1">
          <v-icon size="18" class="mr-1">mdi-account-multiple</v-icon>
          メンバー
        </p>
        <p class="text-caption text-medium-emphasis mb-3">
          Cognito に登録済みのメールアドレスで追加します（確認不要・即時参加）。
          <template v-if="!isEditMode">
            作成時にまとめて招待されます。
          </template>
        </p>

        <v-alert
          v-if="memberError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ memberError }}
        </v-alert>

        <!-- 作成者（自分） -->
        <v-list class="pa-0 mb-2" density="comfortable">
          <v-list-item class="px-2 mb-1" rounded="lg" border>
            <template #prepend>
              <v-avatar color="primary" size="36">
                <span class="text-caption text-white">
                  {{ authStore.avatarLabel || '?' }}
                </span>
              </v-avatar>
            </template>
            <v-list-item-title class="text-body-2 font-weight-medium">
              {{ authStore.displayLabel }}
              <v-chip size="x-small" color="primary" variant="tonal" class="ml-2">
                {{ isEditMode ? 'オーナー' : '作成者（あなた）' }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              {{ authStore.currentUser?.email || '—' }}
            </v-list-item-subtitle>
          </v-list-item>

          <!-- 編集: 既存メンバー -->
          <template v-if="isEditMode">
            <v-list-item
              v-for="(member, idx) in existingMembers.filter(
                (m) => m.userId !== authStore.currentUser?.sub,
              )"
              :key="member.userId || member.email || String(idx)"
              class="px-2 mb-1"
              rounded="lg"
              border
            >
              <template #prepend>
                <v-avatar color="success" size="36">
                  <span class="text-caption text-white">
                    {{ avatarLabelFromName(resolveMemberDisplayName(member)) }}
                  </span>
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ resolveMemberDisplayName(member) }}
                <v-chip
                  v-if="member.userId === liveProject?.createdBy"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  class="ml-2"
                >
                  オーナー
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                {{ member.email || '—' }}
              </v-list-item-subtitle>
              <template #append>
                <v-btn
                  v-if="canRemoveMember(member)"
                  icon="mdi-account-remove"
                  variant="text"
                  size="small"
                  color="error"
                  :loading="isAddingMember"
                  title="メンバーから外す"
                  @click="handleRemoveMember(member)"
                />
              </template>
            </v-list-item>
          </template>

          <!-- 新規: 保留中の招待 -->
          <template v-else>
            <v-list-item
              v-for="email in pendingInviteEmails"
              :key="email"
              class="px-2 mb-1"
              rounded="lg"
              border
            >
              <template #prepend>
                <v-avatar color="info" size="36">
                  <v-icon size="18" color="white">mdi-email-outline</v-icon>
                </v-avatar>
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ email }}
                <v-chip size="x-small" color="info" variant="tonal" class="ml-2">
                  作成時に招待
                </v-chip>
              </v-list-item-title>
              <template #append>
                <v-btn
                  icon="mdi-close"
                  variant="text"
                  size="small"
                  title="リストから外す"
                  @click="removePendingInvite(email)"
                />
              </template>
            </v-list-item>
          </template>
        </v-list>

        <!-- メンバー追加入力（オーナー / 新規作成時） -->
        <div v-if="!isEditMode || isCurrentUserOwner" class="mt-2">
          <p class="text-caption text-medium-emphasis mb-1">メンバーを追加（メール）</p>
          <div class="d-flex ga-2 align-start">
            <v-text-field
              v-model="memberEmailInput"
              placeholder="例：h-sameshima@findix.co.jp"
              :rules="emailRules"
              hide-details="auto"
              density="comfortable"
              class="flex-grow-1"
              @keydown.enter.prevent="handleAddMember"
            />
            <v-btn
              color="primary"
              variant="tonal"
              class="mt-1"
              :loading="isAddingMember"
              :disabled="!memberEmailInput.trim()"
              prepend-icon="mdi-account-plus"
              @click="handleAddMember"
            >
              追加
            </v-btn>
          </div>
        </div>
        <p
          v-else
          class="text-caption text-medium-emphasis mt-2 mb-0"
        >
          メンバーの追加・削除はプロジェクトオーナーのみ可能です。
        </p>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-5 py-3">
        <v-btn
          variant="text"
          :disabled="projectsStore.isLoading || isAddingMember"
          @click="handleCancel"
        >
          キャンセル
        </v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          :loading="projectsStore.isLoading"
          :disabled="!name.trim() || isAddingMember"
          :prepend-icon="isEditMode ? 'mdi-content-save' : 'mdi-plus'"
          @click="handleSubmit"
        >
          {{ submitLabel }}
          <template v-if="!isEditMode && pendingInviteEmails.length > 0">
            （+{{ pendingInviteEmails.length }} 人）
          </template>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
