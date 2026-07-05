/**
 * Transient error detection and auto-retry logic for BashTool.
 *
 * Transient errors are temporary failures (network issues, rate limits, server errors)
 * that can be silently retried without involving the model, saving tokens.
 */

import type { ExecResult } from '../../utils/ShellCommand.js'

const MAX_RETRIES = 2
const BASE_DELAY_MS = 1000

/**
 * Patterns that indicate a transient error worth retrying.
 * Each pattern is checked against the combined stdout+stderr output.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  // Network/connection errors
  /unexpected EOF/i,
  /connection reset by peer/i,
  /connection refused/i,
  /connection timed out/i,
  /network is unreachable/i,
  /temporary failure in name resolution/i,
  /SSL_ERROR/i,
  /OpenSSL.*error/i,
  /socket hang up/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENETUNREACH/i,

  // HTTP transient errors
  /HTTP.*429\b/,
  /rate limit/i,
  /too many requests/i,
  /HTTP.*5\d{2}\b/,
  /server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,

  // GitHub CLI specific transient errors
  /GitHub API.*temporarily unavailable/i,
  /gh.*EOF/i,
  /graphql.*EOF/i,

  // DNS errors
  /Could not resolve host/i,
  /name resolution/i,

  // SSH transient errors
  /ssh.*connection timed out/i,
  /ssh.*connection reset/i,
]

/**
 * Check if a command result looks like a transient error that's worth retrying.
 */
export function isTransientError(result: ExecResult): boolean {
  // Only retry on non-zero exit codes
  if (result.code === 0) return false

  // Don't retry interrupted commands
  if (result.interrupted) return false

  // Don't retry if there's a pre-spawn error (not a transient issue)
  if (result.preSpawnError) return false

  const output = result.stdout || ''
  return TRANSIENT_PATTERNS.some(pattern => pattern.test(output))
}

/**
 * Calculate delay for exponential backoff.
 */
function getRetryDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt)
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry configuration and state for a single command execution.
 */
export interface RetryState {
  attempt: number
  maxRetries: number
  shouldRetry: boolean
}

/**
 * Determine if we should retry and return updated state.
 * Returns null if we shouldn't retry.
 */
export function getRetryDelay_ms(state: RetryState): number | null {
  if (!state.shouldRetry || state.attempt >= state.maxRetries) {
    return null
  }
  return getRetryDelay(state.attempt)
}

/**
 * Create initial retry state.
 */
export function createRetryState(): RetryState {
  return {
    attempt: 0,
    maxRetries: MAX_RETRIES,
    shouldRetry: true,
  }
}

/**
 * Execute a function with automatic retry on transient errors.
 * Returns the first successful result, or the last failed result.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  isTransient: (result: T) => boolean,
  maxRetries: number = MAX_RETRIES,
): Promise<T> {
  let lastResult: T

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await fn()

    // If not transient or last attempt, return immediately
    if (!isTransient(lastResult) || attempt >= maxRetries) {
      return lastResult
    }

    // Wait before retrying with exponential backoff
    const delay = getRetryDelay(attempt)
    await sleep(delay)
  }

  return lastResult!
}
