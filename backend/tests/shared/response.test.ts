import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/shared/errors.js'
import {
  errorResponse,
  fromAppError,
  internalErrorResponse,
  optionsResponse,
  successResponse,
} from '../../src/shared/response.js'

describe('shared/response', () => {
  it('成功レスポンスを正しい形式で返す', () => {
    const result = successResponse(200, { id: '1' }, 'corr-1')
    expect(result.statusCode).toBe(200)
    const body = JSON.parse(result.body as string)
    expect(body.data).toEqual({ id: '1' })
    expect(body.meta.correlationId).toBe('corr-1')
    expect(body.meta.timestamp).toBeDefined()
  })

  it('エラーレスポンスに fields を含める', () => {
    const result = errorResponse(400, 'VALIDATION_ERROR', '入力エラー', 'corr-2', {
      name: '必須です',
    })
    const body = JSON.parse(result.body as string)
    expect(body.error.fields).toEqual({ name: '必須です' })
  })

  it('AppError からレスポンスを変換する', () => {
    const error = new ValidationError('入力内容をご確認ください', { title: '必須' })
    const result = fromAppError(error, 'corr-3')
    expect(result.statusCode).toBe(400)
    const body = JSON.parse(result.body as string)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('内部エラーレスポンスを返す', () => {
    const result = internalErrorResponse('corr-4')
    expect(result.statusCode).toBe(500)
  })

  it('OPTIONS レスポンスを返す', () => {
    const result = optionsResponse()
    expect(result.statusCode).toBe(204)
    expect(result.headers?.['Access-Control-Allow-Origin']).toBe('*')
  })
})