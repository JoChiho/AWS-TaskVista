// ユーザープロフィール API（表示名はクラウド保存）
import apiClient from './client'
import type { ApiResponse } from '@/types/comment'

export interface UserProfile {
  userId: string
  email?: string
  displayName: string | null
  hasDisplayName?: boolean
  createdAt?: string
  updatedAt?: string
}

/** 自分のプロフィールを取得する */
export async function fetchMyProfile(): Promise<UserProfile> {
  const response = await apiClient.get<ApiResponse<UserProfile>>('/me')
  return response.data.data
}

/** 表示名をクラウドに保存する */
export async function updateMyProfile(displayName: string): Promise<UserProfile> {
  const response = await apiClient.put<ApiResponse<UserProfile>>('/me', {
    displayName,
  })
  return response.data.data
}
