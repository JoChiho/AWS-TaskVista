import type { APIGatewayProxyResultV2 } from 'aws-lambda'
import { AppError } from './errors.js'

/** API 成功レスポンスのラッパー */
export interface ApiSuccessResponse<T> {
  data: T
  meta: {
    correlationId: string
    timestamp: string
  }
}

/** API エラーレスポンスのラッパー */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
  meta: {
    correlationId: string
    timestamp: string
  }
}

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Correlation-Id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
}

/** 成功レスポンスを構築する */
export function successResponse<T>(
  statusCode: number,
  data: T,
  correlationId: string,
): APIGatewayProxyResultV2 {
  const body: ApiSuccessResponse<T> = {
    data,
    meta: {
      correlationId,
      timestamp: new Date().toISOString(),
    },
  }

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  }
}

/** エラーレスポンスを構築する */
export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
  fields?: Record<string, string>,
): APIGatewayProxyResultV2 {
  const body: ApiErrorResponse = {
    error: { code, message, ...(fields ? { fields } : {}) },
    meta: {
      correlationId,
      timestamp: new Date().toISOString(),
    },
  }

  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  }
}

/** AppError からエラーレスポンスを構築する */
export function fromAppError(error: AppError, correlationId: string): APIGatewayProxyResultV2 {
  return errorResponse(error.statusCode, error.code, error.message, correlationId, error.fields)
}

/** 予期しない例外を HTTP 500 に変換する */
export function internalErrorResponse(correlationId: string): APIGatewayProxyResultV2 {
  return errorResponse(500, 'INTERNAL_ERROR', 'サーバー内部エラーが発生しました', correlationId)
}

/** CORS プリフライト用レスポンス */
export function optionsResponse(): APIGatewayProxyResultV2 {
  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: '',
  }
}