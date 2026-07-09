import { describe, expect, it } from 'vitest'
import {
  getAuthUser,
  getCorrelationId,
  getPathParam,
  getRequestPath,
  parseBody,
} from '../../src/shared/context.js'
import { UnauthorizedError } from '../../src/shared/errors.js'
import { createMockEvent } from '../helpers/mockEvent.js'

describe('shared/context', () => {
  it('ヘッダーから CorrelationId を取得する', () => {
    const event = createMockEvent({ correlationId: 'corr-123' })
    expect(getCorrelationId(event)).toBe('corr-123')
  })

  it('CorrelationId がない場合は UUID を生成する', () => {
    const event = createMockEvent()
    expect(getCorrelationId(event)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('JWT クレームからユーザー情報を抽出する', () => {
    const event = createMockEvent({ name: '山田太郎', email: 'yamada@example.com' })
    const user = getAuthUser(event)
    expect(user.userId).toBe('user-001')
    expect(user.email).toBe('yamada@example.com')
    expect(user.name).toBe('山田太郎')
  })

  it('JWT がない場合は UnauthorizedError を投げる', () => {
    const event = createMockEvent()
    ;(event.requestContext as { authorizer?: unknown }).authorizer = undefined
    expect(() => getAuthUser(event)).toThrow(UnauthorizedError)
  })

  it('JSON ボディをパースする', () => {
    const event = createMockEvent({ body: { name: '新規プロジェクト' } })
    expect(parseBody<{ name: string }>(event)).toEqual({ name: '新規プロジェクト' })
  })

  it('パスパラメーターを取得する', () => {
    const event = createMockEvent({ pathParameters: { projectId: 'proj-99' } })
    expect(getPathParam(event, 'projectId')).toBe('proj-99')
  })

  it('stage プレフィックスを除いたパスを返す', () => {
    const event = createMockEvent({ path: '/prod/projects' })
    event.requestContext.stage = 'prod'
    expect(getRequestPath(event)).toBe('/projects')
  })
})