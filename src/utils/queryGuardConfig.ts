export const OPENCLAUDE_QUERY_HARD_MAX_MS_ENV =
  'OPENCLAUDE_QUERY_HARD_MAX_MS'

// setTimeout-compatible upper bound; larger values can overflow timer APIs.
export const MAX_CONFIGURABLE_QUERY_HARD_MAX_MS = 0x7fffffff

type EnvLike = Record<string, string | undefined>
type DebugLogger = (
  message: string,
  options?: { level: 'warn' },
) => void

export type QueryGuardResolvedOptions = {
  hardMaxQueryMs?: number
}

function warnInvalidQueryHardMax(
  value: string,
  reason: string,
  log: DebugLogger,
): void {
  log(
    `${OPENCLAUDE_QUERY_HARD_MAX_MS_ENV} invalid value "${value}" (${reason}); using default query hard max`,
    { level: 'warn' },
  )
}

function defaultWarnLogger(message: string): void {
  console.warn(`[OpenClaude] ${message}`)
}

export function getQueryGuardOptionsFromEnv(
  env: EnvLike = process.env,
  log: DebugLogger = defaultWarnLogger,
): QueryGuardResolvedOptions {
  const raw = env[OPENCLAUDE_QUERY_HARD_MAX_MS_ENV]
  const value = raw?.trim()
  if (!value) {
    return {}
  }

  if (!/^\d+$/.test(value)) {
    warnInvalidQueryHardMax(
      value,
      'expected a positive integer in milliseconds',
      log,
    )
    return {}
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    warnInvalidQueryHardMax(value, 'expected a positive finite integer', log)
    return {}
  }

  if (parsed > MAX_CONFIGURABLE_QUERY_HARD_MAX_MS) {
    warnInvalidQueryHardMax(
      value,
      `maximum is ${MAX_CONFIGURABLE_QUERY_HARD_MAX_MS}`,
      log,
    )
    return {}
  }

  return { hardMaxQueryMs: parsed }
}
