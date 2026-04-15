/**
 * Structured Request Logging
 * 
 * JSON Structured logging for all API calls with correlation IDs.
 * Works with streaming responses for complete request/response tracking.
 */

import { randomUUID } from 'crypto'

export interface RequestLog {
  correlationId: string
  timestamp: number
  provider: string
  model: string
  duration: number
  status: 'success' | 'error'
  tokensIn: number
  tokensOut: number
  error?: string
  streaming: boolean
  firstTokenMs?: number
  totalChunks?: number
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggingConfig {
  level: LogLevel
  includeTokens: boolean
  includeErrors: boolean
  prettyPrint: boolean
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

function getLoggingConfig(): LoggingConfig {
  const level = (process.env.LOG_LEVEL as LogLevel) || 'info'
  return {
    level,
    includeTokens: !isTruthy(process.env.LOG_EXCLUDE_TOKENS),
    includeErrors: !isTruthy(process.env.LOG_EXCLUDE_ERRORS),
    prettyPrint: isTruthy(process.env.LOG_PRETTY),
  }
}

function shouldLogLevel(level: LogLevel): boolean {
  const config = getLoggingConfig()
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
  const currentLevel = levels.indexOf(config.level)
  const messageLevel = levels.indexOf(level)
  return messageLevel >= currentLevel
}

function detectProvider(): string {
  const baseUrl = process.env.OPENAI_BASE_URL || ''
  if (baseUrl.includes('nvidia') || baseUrl.includes('integrate.api.nvidia')) return 'nvidia-nim'
  if (baseUrl.includes('minimax')) return 'minimax'
  if (baseUrl.includes('localhost:11434') || baseUrl.includes('localhost:11435')) return 'ollama'
  if (baseUrl.includes('anthropic')) return 'anthropic'
  return 'openai'
}

export function createCorrelationId(): string {
  return randomUUID()
}

export function logRequest(log: RequestLog): void {
  const config = getLoggingConfig()
  
  if (log.status === 'error' && !config.includeErrors) return
  if (!shouldLogLevel(log.status === 'error' ? 'error' : 'info')) return
  
  const logEntry: Record<string, unknown> = {
    type: 'request',
    correlationId: log.correlationId,
    timestamp: log.timestamp,
    provider: log.provider,
    model: log.model,
    duration_ms: log.duration,
    status: log.status,
  }
  
  if (config.includeTokens) {
    logEntry.tokens_in = log.tokensIn
    logEntry.tokens_out = log.tokensOut
  }
  
  if (log.streaming) {
    logEntry.streaming = true
    if (log.firstTokenMs !== undefined) logEntry.first_token_ms = log.firstTokenMs
    if (log.totalChunks !== undefined) logEntry.total_chunks = log.totalChunks
  }
  
  if (log.error) {
    logEntry.error = log.error
    logEntry.level = 'error'
  }
  
  if (config.prettyPrint) {
    console.log(JSON.stringify(logEntry, null, 2))
  } else {
    console.log(JSON.stringify(logEntry))
  }
}

export function logStreamEvent(
  correlationId: string,
  eventType: 'start' | 'chunk' | 'end',
  data?: Record<string, unknown>,
): void {
  if (!shouldLogLevel('debug')) return
  
  console.log(JSON.stringify({
    type: `stream_${eventType}`,
    correlationId,
    timestamp: Date.now(),
    ...data,
  }))
}

export function logApiCallStart(provider?: string, model?: string): { 
  correlationId: string
  startTime: number 
} {
  const correlationId = createCorrelationId()
  const startTime = Date.now()
  
  if (shouldLogLevel('info')) {
    console.log(JSON.stringify({
      type: 'api_call_start',
      correlationId,
      timestamp: startTime,
      provider: provider ?? detectProvider(),
      model,
    }))
  }
  
  return { correlationId, startTime }
}

export function logApiCallEnd(
  correlationId: string,
  startTime: number,
  model: string,
  status: 'success' | 'error',
  tokensIn: number,
  tokensOut: number,
  streaming: boolean,
  firstTokenMs?: number,
  totalChunks?: number,
  error?: string,
): void {
  const duration = Date.now() - startTime
  const provider = detectProvider()
  
  logRequest({
    correlationId,
    timestamp: Date.now(),
    provider,
    model,
    duration,
    status,
    tokensIn,
    tokensOut,
    error,
    streaming,
    firstTokenMs,
    totalChunks,
  })
  
  if (shouldLogLevel('info')) {
    console.log(JSON.stringify({
      type: 'api_call_end',
      correlationId,
      timestamp: Date.now(),
      provider,
      model,
      status,
      duration_ms: duration,
    }))
  }
}