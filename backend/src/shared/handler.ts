import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { AppError } from './errors.js'
import { getCorrelationId } from './context.js'
import { logError, logWarn } from './logger.js'
import {
  fromAppError,
  internalErrorResponse,
  optionsResponse,
} from './response.js'

/** Lambda ハンドラーの共通ラッパー */
export async function withHandler(
  event: APIGatewayProxyEventV2,
  action: string,
  handler: (correlationId: string) => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  const correlationId = getCorrelationId(event)
  const start = Date.now()

  if (event.requestContext.http.method === 'OPTIONS') {
    return optionsResponse()
  }

  try {
    const result = await handler(correlationId)
    const duration = Date.now() - start

    if (duration > 5000) {
      logWarn(correlationId, 'リクエストの処理時間が閾値を超えました', {
        requestId: event.requestContext.requestId,
        duration,
        action,
      })
    }

    return result
  } catch (error) {
    const duration = Date.now() - start

    if (error instanceof AppError) {
      logWarn(correlationId, error.message, {
        requestId: event.requestContext.requestId,
        duration,
        action,
      })
      return fromAppError(error, correlationId)
    }

    logError(correlationId, '未処理の例外が発生しました', {
      requestId: event.requestContext.requestId,
      duration,
      action,
      error: error instanceof Error ? error.message : 'Unknown error',
    })

    return internalErrorResponse(correlationId)
  }
}