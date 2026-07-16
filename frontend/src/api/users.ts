// ユーザープロフィール API（表示名はクラウド保存）
import apiClient from './client'
import type { ApiResponse } from '@/types/comment'

export interface UserProfile {
  userId: string
  email?: string
  displayName: string | null
  familyName?: string | null
  givenName?: string | null
  hasDisplayName?: boolean
  createdAt?: string
  updatedAt?: string
}

export interface UpdateProfilePayload {
  familyName: string
  givenName: string
}

/** 自分のプロフィールを取得する */
export async function fetchMyProfile(): Promise<UserProfile> {
  const response = await apiClient.get<ApiResponse<UserProfile>>('/me')
  return response.data.data
}

/** 姓・名をクラウドに保存する */
export async function updateMyProfile(
  payload: UpdateProfilePayload,
): Promise<UserProfile> {
  const response = await apiClient.put<ApiResponse<UserProfile>>('/me', {
    familyName: payload.familyName.trim(),
    givenName: payload.givenName.trim(),
  })
  return response.data.data
}

/**
 * 複数 userId の表示名を一括取得する
 * @returns names: フルネーム / familyNames: 姓のみ（アバター用）
 */
export async function fetchDisplayNames(userIds: string[]): Promise<{
  names: Record<string, string>
  familyNames: Record<string, string>
}> {
  if (userIds.length === 0) return { names: {}, familyNames: {} }
  const response = await apiClient.post<
    ApiResponse<{
      names: Record<string, string>
      familyNames?: Record<string, string>
    }>
  >('/users/display-names', { userIds })
  return {
    names: response.data.data?.names ?? {},
    familyNames: response.data.data?.familyNames ?? {},
  }
}
