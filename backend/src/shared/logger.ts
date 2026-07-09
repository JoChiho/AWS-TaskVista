/** 構造化ログのレベル */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

/** 構造化ログのペイロード */
export interface LogEntry {
  correlationId: string
  requestId?: string
  level: LogLevel
  message: string
  timestamp: string
  duration?: number
  userId?: string
  resourceId?: string
  action?: string
  error?: string
}

/** CloudWatch 向けの構造化 JSON ログを出力する */
export function log(entry: Omit<LogEntry, 'timestamp'> & { timestamp?: string }): void {
  const payload: LogEntry = {
    ...entry,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  }
  console.log(JSON.stringify(payload))
}

export function logInfo(
  correlationId: string,
  message: string,
  extra?: Partial<Omit<LogEntry, 'correlationId' | 'level' | 'message' | 'timestamp'>>,
): void {
  log({ correlationId, level: 'INFO', message, ...extra })
}

export function logWarn(
  correlationId: string,
  message: string,
  extra?: Partial<Omit<LogEntry, 'correlationId' | 'level' | 'message' | 'timestamp'>>,
): void {
  log({ correlationId, level: 'WARN', message, ...extra })
}

export function logError(
  correlationId: string,
  message: string,
  extra?: Partial<Omit<LogEntry, 'correlationId' | 'level' | 'message' | 'timestamp'>>,
): void {
  log({ correlationId, level: 'ERROR', message, ...extra })
}