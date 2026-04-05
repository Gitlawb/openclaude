import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAPIProvider, type APIProvider } from '../../utils/model/providers.js'
import { lock } from '../../utils/lockfile.js'
import { sleep } from '../../utils/sleep.js'

const DEFAULT_RPM_WINDOW_MS = 60_000
const DEFAULT_RPD_WARN_THRESHOLD_PCT = 0.9
const CLIENT_RPD_STATE_FILENAME = 'client-quota-rpd.json'
const RPD_LOCK_STALE_MS = 10_000
const RPD_LOCK_MAX_RETRIES = 20
const RPD_LOCK_MIN_TIMEOUT_MS = 10
const RPD_LOCK_MAX_TIMEOUT_MS = 100

class RpdLockContentionError extends Error {
  constructor(statePath: string) {
    super(
      `Client quota guard blocked request: failed to acquire daily quota lock at ${statePath}. ` +
        'Another OpenClaude process may be using quota state; retry shortly.',
    )
    this.name = 'RpdLockContentionError'
  }
}

const ENV_CLIENT_RPM_LIMIT = 'CLAUDE_CODE_CLIENT_RPM_LIMIT'
const ENV_CLIENT_RPM_WINDOW_MS = 'CLAUDE_CODE_CLIENT_RPM_WINDOW_MS'
const ENV_CLIENT_RPD_LIMIT = 'CLAUDE_CODE_CLIENT_RPD_LIMIT'
const ENV_CLIENT_RPD_WARN_THRESHOLD_PCT =
  'CLAUDE_CODE_CLIENT_RPD_WARN_THRESHOLD_PCT'
const ENV_CLIENT_RPD_STATE_FILE = 'CLAUDE_CODE_CLIENT_RPD_STATE_FILE'

type RpdState = {
  version: 1
  utcDay: string
  attempts: number
  warnedAtIso: string | null
}

export type ClientQuotaGuardOptions = {
  signal?: AbortSignal
  abortError?: () => Error
  nowMs?: () => number
  sleepFn?: (ms: number) => Promise<void>
  provider?: APIProvider
}

let rpmAttemptTimestampsMs: number[] = []
let rpmGuardMutexTail: Promise<void> = Promise.resolve()

async function withRpmGuardLock<T>(fn: () => T): Promise<T> {
  const previous = rpmGuardMutexTail
  let release: (() => void) | undefined
  const next = new Promise<void>(resolve => {
    release = resolve
  })
  rpmGuardMutexTail = previous.then(() => next)

  await previous
  try {
    return fn()
  } finally {
    release?.()
  }
}

function isClientQuotaGuardProvider(provider: APIProvider): boolean {
  return (
    provider === 'openai' ||
    provider === 'gemini' ||
    provider === 'github' ||
    provider === 'codex'
  )
}

function parsePositiveIntEnv(name: string): number | null {
  const raw = process.env[name]
  if (!raw) return null
  const parsed = parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function parseWarnThresholdPct(): number {
  const raw = process.env[ENV_CLIENT_RPD_WARN_THRESHOLD_PCT]
  if (!raw) return DEFAULT_RPD_WARN_THRESHOLD_PCT
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return DEFAULT_RPD_WARN_THRESHOLD_PCT
  }
  return parsed
}

function getNowMs(getNow?: () => number): number {
  return getNow ? getNow() : Date.now()
}

function getUtcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

function isPathWithinDirectory(
  candidatePath: string,
  directoryPath: string,
): boolean {
  const relativePath = relative(directoryPath, candidatePath)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function getRpdStatePath(): string {
  const configHomeDir = getClaudeConfigHomeDir()
  const defaultPath = join(configHomeDir, CLIENT_RPD_STATE_FILENAME)
  const override = process.env[ENV_CLIENT_RPD_STATE_FILE]
  const trimmedOverride = override?.trim()
  if (trimmedOverride && trimmedOverride.length > 0) {
    const candidatePath = isAbsolute(trimmedOverride)
      ? trimmedOverride
      : join(configHomeDir, trimmedOverride)

    const resolvedConfigHomeDir = resolve(configHomeDir)
    const resolvedCandidatePath = resolve(candidatePath)

    if (isPathWithinDirectory(resolvedCandidatePath, resolvedConfigHomeDir)) {
      return resolvedCandidatePath
    }

    logForDebugging(
      `[client-quota] Ignoring ${ENV_CLIENT_RPD_STATE_FILE} outside config dir: ${trimmedOverride}`,
    )
  }
  return defaultPath
}

function throwIfAborted(options: ClientQuotaGuardOptions): void {
  if (!options.signal?.aborted) {
    return
  }
  throw options.abortError ? options.abortError() : new Error('Request aborted')
}

function defaultRpdState(utcDay: string): RpdState {
  return {
    version: 1,
    utcDay,
    attempts: 0,
    warnedAtIso: null,
  }
}

async function loadRpdState(path: string, utcDay: string): Promise<RpdState> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') {
      return defaultRpdState(utcDay)
    }
    throw error
  }

  let parsed: Partial<RpdState>
  if (raw.trim().length === 0) {
    return defaultRpdState(utcDay)
  }

  try {
    parsed = JSON.parse(raw) as Partial<RpdState>
  } catch (error) {
    throw new Error(
      `invalid RPD state JSON (${path}): ${errorMessage(error)}`,
    )
  }

  if (
    parsed.version !== 1 ||
    typeof parsed.utcDay !== 'string' ||
    typeof parsed.attempts !== 'number'
  ) {
    throw new Error(
      `invalid RPD state schema (${path}); expected version/utcDay/attempts`,
    )
  }

  if (parsed.utcDay !== utcDay) {
    return defaultRpdState(utcDay)
  }

  return {
    version: 1,
    utcDay,
    attempts: Math.max(0, Math.floor(parsed.attempts)),
    warnedAtIso:
      typeof parsed.warnedAtIso === 'string' ? parsed.warnedAtIso : null,
  }
}

async function saveRpdState(path: string, state: RpdState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(state), {
    encoding: 'utf8',
    mode: 0o600,
  })

  try {
    await rename(tempPath, path)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    throw error
  }
}

function toRpdPersistenceFailureError(statePath: string, error: unknown): Error {
  return new Error(
    `Client quota guard blocked request: failed to persist daily state at ${statePath}. ` +
      `Fix file permissions/path or set ${ENV_CLIENT_RPD_STATE_FILE}. ` +
      `Original error: ${errorMessage(error)}`,
  )
}

async function acquireRpdFileLock(
  statePath: string,
  options: ClientQuotaGuardOptions,
): Promise<() => Promise<void>> {
  const lockAcquireDeadlineMs = getNowMs(options.nowMs) + RPD_LOCK_STALE_MS

  try {
    await mkdir(dirname(statePath), { recursive: true })
    // proper-lockfile requires a target path that already exists.
    await writeFile(statePath, '', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a',
    })

    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(options)
      try {
        return await lock(statePath, {
          stale: RPD_LOCK_STALE_MS,
          retries: 0,
        })
      } catch (error) {
        if (options.signal?.aborted) {
          throw options.abortError
            ? options.abortError()
            : new Error('Request aborted')
        }

        const code = (error as { code?: unknown }).code
        if (code !== 'ELOCKED') {
          throw error
        }

        if (
          attempt >= RPD_LOCK_MAX_RETRIES ||
          getNowMs(options.nowMs) >= lockAcquireDeadlineMs
        ) {
          throw new RpdLockContentionError(statePath)
        }

        const backoffMs = Math.min(
          RPD_LOCK_MAX_TIMEOUT_MS,
          RPD_LOCK_MIN_TIMEOUT_MS * Math.pow(2, attempt),
        )
        await sleep(backoffMs, options.signal, {
          abortError: options.abortError,
        })
      }
    }
  } catch (error) {
    if (error instanceof RpdLockContentionError) {
      throw error
    }

    if (options.signal?.aborted) {
      throw error
    }
    throw toRpdPersistenceFailureError(statePath, error)
  }
}

async function enforceRpmGuard(options: ClientQuotaGuardOptions): Promise<void> {
  const rpmLimit = parsePositiveIntEnv(ENV_CLIENT_RPM_LIMIT)
  if (!rpmLimit) return

  const rpmWindowMs =
    parsePositiveIntEnv(ENV_CLIENT_RPM_WINDOW_MS) ?? DEFAULT_RPM_WINDOW_MS
  const sleeper =
    options.sleepFn ??
    (async (ms: number) =>
      sleep(ms, options.signal, {
        abortError: options.abortError,
      }))

  while (true) {
    const waitMs = await withRpmGuardLock(() => {
      const nowMs = getNowMs(options.nowMs)
      rpmAttemptTimestampsMs = rpmAttemptTimestampsMs.filter(
        ts => nowMs - ts < rpmWindowMs,
      )

      if (rpmAttemptTimestampsMs.length < rpmLimit) {
        rpmAttemptTimestampsMs.push(nowMs)
        return 0
      }

      const oldestTs = rpmAttemptTimestampsMs[0]
      if (oldestTs === undefined) {
        rpmAttemptTimestampsMs = []
        return 0
      }

      return Math.max(1, oldestTs + rpmWindowMs - nowMs)
    })

    if (waitMs === 0) {
      return
    }

    logForDebugging(
      `[client-quota] RPM guard sleeping ${waitMs}ms (${rpmAttemptTimestampsMs.length}/${rpmLimit} in ${rpmWindowMs}ms window)`,
    )
    await sleeper(waitMs)
  }
}

async function enforceRpdGuard(
  options: ClientQuotaGuardOptions,
  precheckOnly = false,
): Promise<void> {
  const rpdLimit = parsePositiveIntEnv(ENV_CLIENT_RPD_LIMIT)
  if (!rpdLimit) return

  throwIfAborted(options)

  const nowMs = getNowMs(options.nowMs)
  const utcDay = getUtcDay(nowMs)
  const statePath = getRpdStatePath()
  const warnThresholdPct = parseWarnThresholdPct()
  const release = await acquireRpdFileLock(statePath, options)

  try {
    throwIfAborted(options)

    let state: RpdState
    try {
      state = await loadRpdState(statePath, utcDay)
    } catch (error) {
      throw toRpdPersistenceFailureError(statePath, error)
    }

    if (state.attempts >= rpdLimit) {
      throw new Error(
        `Client quota guard blocked request: daily cap reached (${rpdLimit}/day). ` +
          `Increase ${ENV_CLIENT_RPD_LIMIT} or wait until UTC day reset.`,
      )
    }

    if (precheckOnly) {
      return
    }

    state.attempts += 1

    if (
      !state.warnedAtIso &&
      state.attempts / rpdLimit >= warnThresholdPct
    ) {
      state.warnedAtIso = new Date(nowMs).toISOString()
      logForDebugging(
        `[client-quota] RPD usage warning: ${state.attempts}/${rpdLimit} (${Math.round((state.attempts / rpdLimit) * 100)}%)`,
      )
    }

    try {
      await saveRpdState(statePath, state)
    } catch (error) {
      logForDebugging(
        `[client-quota] Failed to persist RPD state (${statePath}): ${errorMessage(error)}`,
      )
      throw toRpdPersistenceFailureError(statePath, error)
    }
  } finally {
    await release().catch(error => {
      logForDebugging(
        `[client-quota] Failed to release RPD file lock (${statePath}): ${errorMessage(error)}`,
      )
    })
  }
}

export async function enforceClientQuotaGuards(
  options: ClientQuotaGuardOptions = {},
): Promise<void> {
  const provider = options.provider ?? getAPIProvider()
  if (!isClientQuotaGuardProvider(provider)) {
    return
  }

  const hasRpmLimit = parsePositiveIntEnv(ENV_CLIENT_RPM_LIMIT)
  const hasRpdLimit = parsePositiveIntEnv(ENV_CLIENT_RPD_LIMIT)
  if (!hasRpmLimit && !hasRpdLimit) {
    return
  }

  // Avoid waiting on RPM when daily RPD cap has already been reached.
  // Run this precheck only when RPM is enabled; for RPD-only mode, do a
  // single full RPD pass below to avoid duplicate file lock/I-O.
  if (hasRpdLimit && hasRpmLimit) {
    await enforceRpdGuard(options, true)
  }

  if (hasRpmLimit) {
    await enforceRpmGuard(options)
  }

  if (hasRpdLimit) {
    await enforceRpdGuard(options)
  }
}

export function resetClientQuotaGuardsForTests(): void {
  rpmAttemptTimestampsMs = []
  rpmGuardMutexTail = Promise.resolve()
}

export const __private__ = {
  getRpdStatePath,
}
