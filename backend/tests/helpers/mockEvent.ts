import type { APIGatewayProxyEventV2 } from 'aws-lambda'
import { USER_ID } from './fixtures.js'

interface MockEventOptions {
  method?: string
  path?: string
  body?: unknown
  pathParameters?: Record<string, string>
  correlationId?: string
  userId?: string
  email?: string
  name?: string
}

/** API Gateway HTTP API v2 のテスト用イベントを生成する */
export function createMockEvent(options: MockEventOptions = {}): APIGatewayProxyEventV2 {
  const userId = options.userId ?? USER_ID

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: options.path ?? '/projects',
    rawQueryString: '',
    headers: {
      authorization: 'Bearer test-token',
      ...(options.correlationId ? { 'x-correlation-id': options.correlationId } : {}),
    },
    requestContext: {
      accountId: '312310269639',
      apiId: 'test-api',
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method: options.method ?? 'GET',
        path: options.path ?? '/projects',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-request-id',
      routeKey: '$default',
      stage: '$default',
      time: '07/Jul/2026:10:00:00 +0000',
      timeEpoch: 1783447200000,
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: options.email ?? 'test@example.com',
            name: options.name ?? 'テストユーザー',
          },
        },
      },
    },
    pathParameters: options.pathParameters,
    body: options.body ? JSON.stringify(options.body) : undefined,
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2
}