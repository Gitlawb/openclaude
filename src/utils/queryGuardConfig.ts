export const OPENCLAUDE_QUERY_IDLE_TIMEOUT_MS_ENV =
  'OPENCLAUDE_QUERY_IDLE_TIMEOUT_MS'
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
  idleTimeoutMs?: number
  hardMaxQueryMs?: number
}

function warnInvalidQueryTimeout(
  envName: string,
  defaultDescription: string,
  value: string,
  reason: string,
  log: DebugLogger,
): void {
  log(
    `${envName} invalid value "${value}" (${reason}); using default ${defaultDescription}`,
    { level: 'warn' },
  )
}

function defaultWarnLogger(message: string): void {
  console.warn(`[OpenClaude] ${message}`)
}

function getPositiveTimeoutFromEnv(
  env: EnvLike,
  envName: string,
  defaultDescription: string,
  log: DebugLogger,
): number | undefined {
  const raw = env[envName]
  const value = raw?.trim()
  if (!value) {
    return undefined
  }

  if (!/^\d+$/.test(value)) {
    warnInvalidQueryTimeout(
      envName,
      defaultDescription,
      value,
      'expected a positive integer in milliseconds',
      log,
    )
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    warnInvalidQueryTimeout(
      envName,
      defaultDescription,
      value,
      'expected a positive finite integer',
      log,
    )
    return undefined
  }

  if (parsed > MAX_CONFIGURABLE_QUERY_HARD_MAX_MS) {
    warnInvalidQueryTimeout(
      envName,
      defaultDescription,
      value,
      `maximum is ${MAX_CONFIGURABLE_QUERY_HARD_MAX_MS}`,
      log,
    )
    return undefined
  }

  return parsed
}

export function getQueryGuardOptionsFromEnv(
  env: EnvLike = process.env,
  log: DebugLogger = defaultWarnLogger,
): QueryGuardResolvedOptions {
  const idleTimeoutMs = getPositiveTimeoutFromEnv(
    env,
    OPENCLAUDE_QUERY_IDLE_TIMEOUT_MS_ENV,
    'query idle timeout',
    log,
  )
  const hardMaxQueryMs = getPositiveTimeoutFromEnv(
    env,
    OPENCLAUDE_QUERY_HARD_MAX_MS_ENV,
    'query hard max',
    log,
  )

  return {
    ...(idleTimeoutMs !== undefined && { idleTimeoutMs }),
    ...(hardMaxQueryMs !== undefined && { hardMaxQueryMs }),
  }
}
