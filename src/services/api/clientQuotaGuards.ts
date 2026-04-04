import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logForDebugging } from '../../utils/debug.js'
import { getAPIProvider, type APIProvider } from '../../utils/model/providers.js'
import { sleep } from '../../utils/sleep.js'

const DEFAULT_RPM_WINDOW_MS = 60_000
const DEFAULT_RPD_WARN_THRESHOLD_PCT = 0.9
const CLIENT_RPD_STATE_FILENAME = 'client-quota-rpd.json'

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
}

let rpmAttemptTimestampsMs: number[] = []
let rpdLockPromise: Promise<void> | null = null

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

function getRpdStatePath(): string {
  const override = process.env[ENV_CLIENT_RPD_STATE_FILE]
  if (override && override.trim().length > 0) {
    return override
  }
  return join(getClaudeConfigHomeDir(), CLIENT_RPD_STATE_FILENAME)
}

async function withRpdLock<T>(fn: () => Promise<T>): Promise<T> {
  while (rpdLockPromise) {
    await rpdLockPromise
  }

  let releaseLock: (() => void) | undefined
  rpdLockPromise = new Promise<void>(resolve => {
    releaseLock = resolve
  })

  try {
    return await fn()
  } finally {
    rpdLockPromise = null
    releaseLock?.()
  }
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
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as Partial<RpdState>
    if (
      parsed.version !== 1 ||
      typeof parsed.utcDay !== 'string' ||
      typeof parsed.attempts !== 'number'
    ) {
      return defaultRpdState(utcDay)
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
  } catch {
    return defaultRpdState(utcDay)
  }
}

async function saveRpdState(path: string, state: RpdState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state), 'utf8')
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
    const nowMs = getNowMs(options.nowMs)
    rpmAttemptTimestampsMs = rpmAttemptTimestampsMs.filter(
      ts => nowMs - ts < rpmWindowMs,
    )

    if (rpmAttemptTimestampsMs.length < rpmLimit) {
      rpmAttemptTimestampsMs.push(nowMs)
      return
    }

    const oldestTs = rpmAttemptTimestampsMs[0]
    if (oldestTs === undefined) {
      rpmAttemptTimestampsMs = []
      continue
    }

    const waitMs = Math.max(1, oldestTs + rpmWindowMs - nowMs)
    logForDebugging(
      `[client-quota] RPM guard sleeping ${waitMs}ms (${rpmAttemptTimestampsMs.length}/${rpmLimit} in ${rpmWindowMs}ms window)`,
    )
    await sleeper(waitMs)
  }
}

async function enforceRpdGuard(options: ClientQuotaGuardOptions): Promise<void> {
  const rpdLimit = parsePositiveIntEnv(ENV_CLIENT_RPD_LIMIT)
  if (!rpdLimit) return

  const nowMs = getNowMs(options.nowMs)
  const utcDay = getUtcDay(nowMs)
  const statePath = getRpdStatePath()
  const warnThresholdPct = parseWarnThresholdPct()

  await withRpdLock(async () => {
    const state = await loadRpdState(statePath, utcDay)

    if (state.attempts >= rpdLimit) {
      throw new Error(
        `Client quota guard blocked request: daily cap reached (${rpdLimit}/day). ` +
          `Increase ${ENV_CLIENT_RPD_LIMIT} or wait until UTC day reset.`,
      )
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
    }
  })
}

export async function enforceClientQuotaGuards(
  options: ClientQuotaGuardOptions = {},
): Promise<void> {
  const provider = getAPIProvider()
  if (!isClientQuotaGuardProvider(provider)) {
    return
  }

  const hasRpmLimit = parsePositiveIntEnv(ENV_CLIENT_RPM_LIMIT)
  const hasRpdLimit = parsePositiveIntEnv(ENV_CLIENT_RPD_LIMIT)
  if (!hasRpmLimit && !hasRpdLimit) {
    return
  }

  await enforceRpmGuard(options)
  await enforceRpdGuard(options)
}

export function resetClientQuotaGuardsForTests(): void {
  rpmAttemptTimestampsMs = []
  rpdLockPromise = null
}

export const __private__ = {
  getRpdStatePath,
}