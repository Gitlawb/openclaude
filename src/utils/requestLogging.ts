/**
 * Structured Request Logging
 * 
 * Uses existing logForDebugging for structured logging.
 */

import { randomUUID } from 'crypto'
import { logForDebugging } from './debug.js'

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
}

export function createCorrelationId(): string {
  return randomUUID()
}

export function logApiCallStart(
  provider: string,
  model: string,
): { correlationId: string; startTime: number } {
  const correlationId = createCorrelationId()
  const startTime = Date.now()

  logForDebugging(
    JSON.stringify({
      type: 'api_call_start',
      correlationId,
      provider,
      model,
      timestamp: startTime,
    }),
    { level: 'debug' },
  )

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

  const logData: Record<string, unknown> = {
    type: status === 'error' ? 'api_call_error' : 'api_call_end',
    correlationId,
    model,
    duration_ms: duration,
    status,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    streaming,
  }

  if (firstTokenMs !== undefined) {
    logData.first_token_ms = firstTokenMs
  }

  if (totalChunks !== undefined) {
    logData.total_chunks = totalChunks
  }

  if (error) {
    logData.error = error
  }

  logForDebugging(
    JSON.stringify(logData),
    { level: status === 'error' ? 'error' : 'debug' },
  )
}