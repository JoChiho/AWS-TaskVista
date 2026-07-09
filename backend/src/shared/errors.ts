/** アプリケーション共通エラーコード */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'

/** アプリケーション基底エラークラス */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/** 入力バリデーションエラー（HTTP 400） */
export class ValidationError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super(400, 'VALIDATION_ERROR', message, fields)
  }
}

/** リソース未検出エラー（HTTP 404） */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message)
  }
}

/** 権限不足エラー（HTTP 403） */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, 'FORBIDDEN', message)
  }
}

/** 未認証エラー（HTTP 401） */
export class UnauthorizedError extends AppError {
  constructor(message = '認証が必要です') {
    super(401, 'UNAUTHORIZED', message)
  }
}