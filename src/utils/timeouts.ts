import { DEFAULT_QUERY_HARD_MAX_MS } from './QueryGuard.js'

// Constants for timeout values
const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const MAX_TIMEOUT_MS = 600_000 // 10 minutes

type EnvLike = Record<string, string | undefined>

function capToQueryHardMax(timeoutMs: number): number {
  return Math.min(timeoutMs, DEFAULT_QUERY_HARD_MAX_MS)
}

/**
 * Get the default timeout for bash operations in milliseconds
 * Checks BASH_DEFAULT_TIMEOUT_MS environment variable or returns 2 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getDefaultBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_DEFAULT_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return capToQueryHardMax(parsed)
    }
  }
  return capToQueryHardMax(DEFAULT_TIMEOUT_MS)
}

/**
 * Get the maximum timeout for bash operations in milliseconds
 * Checks BASH_MAX_TIMEOUT_MS environment variable or returns 10 minutes default
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getMaxBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_MAX_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      // Ensure max is at least as large as default
      return capToQueryHardMax(Math.max(parsed, getDefaultBashTimeoutMs(env)))
    }
  }
  // Always ensure max is at least as large as default
  return capToQueryHardMax(Math.max(MAX_TIMEOUT_MS, getDefaultBashTimeoutMs(env)))
}

export function getEffectiveBashTimeoutMs(
  requestedTimeout: unknown,
  env: EnvLike = process.env,
): number {
  const timeoutMs =
    typeof requestedTimeout === 'number' &&
    Number.isFinite(requestedTimeout) &&
    requestedTimeout > 0
      ? requestedTimeout
      : getDefaultBashTimeoutMs(env)

  return Math.min(timeoutMs, getMaxBashTimeoutMs(env))
}
