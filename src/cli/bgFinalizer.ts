import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  beginBackgroundSessionSignalTracking,
  type ObservedBackgroundSessionSignal,
} from '../utils/backgroundSessionTermination.js'
import {
  readBackgroundSessionForOwner,
  recordBackgroundSessionNaturalTermination,
  recordBackgroundSessionNaturalTerminationSync,
  type BackgroundSession,
} from './bgRegistry.js'
import {
  BACKGROUND_SESSION_CLEANUP_OWNER_PID_ENV,
  BACKGROUND_SESSION_CLEANUP_WORKER_ENV,
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
} from './bgRouting.js'

export {
  BACKGROUND_SESSION_CLEANUP_OWNER_PID_ENV,
  BACKGROUND_SESSION_CLEANUP_WORKER_ENV,
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
} from './bgRouting.js'

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/
const DEFAULT_REGISTRATION_WAIT_MS = 5_000
const DEFAULT_REGISTRATION_POLL_MS = 10
const DEFAULT_CLEANUP_WORKER_WAIT_MS = 10_000
const DEFAULT_CLEANUP_WORKER_POLL_MS = 25

type PrepareBackgroundSessionFinalizerOptions = {
  env?: NodeJS.ProcessEnv
  pid?: number
  readSession?: (id: string) => Promise<BackgroundSession | null>
  isLauncherAlive?: (pid: number) => boolean
  sleep?: (ms: number) => Promise<void>
  registrationWaitMs?: number
  registrationPollMs?: number
  registerCleanup?: (fn: () => void | Promise<void>) => () => void
  onBeforeExit?: (listener: () => void | Promise<void>) => void
  onExit?: (listener: (code: number) => void) => void
  finalize?: typeof recordBackgroundSessionNaturalTermination
  finalizeSync?: typeof recordBackgroundSessionNaturalTerminationSync
  startCleanupWorker?: (
    sessionId: string,
    ownerPid: number,
    launcherPid: number,
    settingsArgs: string[],
  ) => void
  settingsArgs?: string[]
  settingsCwd?: string
  getObservedSignal?: () => ObservedBackgroundSessionSignal | undefined
  debug?: (message: string) => void
}

export type BackgroundSessionFinalizerPreparation =
  | 'not-background'
  | 'invalid-routing'
  | 'installed'

function boundedFailureKind(error: unknown): string {
  if (error && typeof error === 'object') {
    if ('code' in error && typeof error.code === 'string') {
      return error.code.slice(0, 32)
    }
    if ('name' in error && typeof error.name === 'string') {
      return error.name.slice(0, 32)
    }
  }
  return 'unknown'
}

function defaultDebug(message: string): void {
  logForDebugging(message, { level: 'error' })
}

function normalizeProcessExitCode(
  value: string | number | null | undefined,
): number {
  if (value === undefined) return 0
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof parsed === 'number' &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : 1
}

function currentProcessExitCode(): number {
  return normalizeProcessExitCode(process.exitCode)
}

function reportFinalizationFailure(
  debug: (message: string) => void,
  error: unknown,
): void {
  try {
    debug(
      `Background session finalization failed (${boundedFailureKind(error)})`,
    )
  } catch {
    // Diagnostics must never replace the child process's original outcome.
  }
}

function reportPostFinalizationCleanupFailure(
  debug: (message: string) => void,
  error: unknown,
): void {
  try {
    debug(
      `Background session post-finalization cleanup failed (${boundedFailureKind(error)})`,
    )
  } catch {
    // Diagnostics must never replace the child process's original outcome.
  }
}

function parsePositivePid(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : undefined
}

function isBackgroundLauncherAlive(pid: number): boolean {
  // PID 1 is a valid launcher inside a container. The shared helper excludes
  // it because it also serves kill/lock callers, but this bounded registration
  // poll only needs to know that the container's init process still exists.
  return pid === 1 || isProcessRunning(pid)
}

function scrubRoutingEnvironment(env: NodeJS.ProcessEnv): void {
  delete env[BACKGROUND_SESSION_ID_ENV]
  delete env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]
}

async function waitForOwnedSession(
  id: string,
  ownerPid: number,
  launcherPid: number,
  options: Required<
    Pick<
      PrepareBackgroundSessionFinalizerOptions,
      | 'readSession'
      | 'isLauncherAlive'
      | 'sleep'
      | 'registrationWaitMs'
      | 'registrationPollMs'
    >
  >,
): Promise<BackgroundSession | 'mismatch' | 'timeout'> {
  const attempts = Math.max(
    1,
    Math.ceil(options.registrationWaitMs / options.registrationPollMs),
  )
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await options.readSession(id)
    if (session) return session.pid === ownerPid ? session : 'mismatch'
    if (!options.isLauncherAlive(launcherPid)) {
      const finalSession = await options.readSession(id)
      if (finalSession) {
        return finalSession.pid === ownerPid ? finalSession : 'mismatch'
      }
      return 'timeout'
    }
    await options.sleep(options.registrationPollMs)
  }
  const session = await options.readSession(id)
  if (session) return session.pid === ownerPid ? session : 'mismatch'
  return 'timeout'
}

type BackgroundSessionCleanupWorkerStartOptions = {
  sessionId: string
  ownerPid: number
  launcherPid: number
  env?: NodeJS.ProcessEnv
  execPath?: string
  execArgv?: string[]
  entrypoint?: string
  settingsArgs?: string[]
  settingsCwd?: string
  spawnProcess?: typeof spawn
}

function backgroundRetentionSettingsArgs(
  args: string[],
  settingsCwd: string,
): string[] {
  const selected: string[] = []
  for (const flag of ['--settings', '--setting-sources']) {
    const inlinePrefix = `${flag}=`
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]
      if (arg?.startsWith(inlinePrefix)) {
        const value = backgroundRetentionSettingsValue(
          flag,
          arg.slice(inlinePrefix.length),
          settingsCwd,
        )
        if (value !== undefined) selected.push(flag, value)
        break
      }
      if (arg === flag && index + 1 < args.length) {
        const value = backgroundRetentionSettingsValue(
          flag,
          args[index + 1]!,
          settingsCwd,
        )
        if (value !== undefined) selected.push(flag, value)
        break
      }
    }
  }
  return selected
}

function backgroundRetentionSettingsValue(
  flag: string,
  value: string,
  settingsCwd: string,
): string | undefined {
  if (flag !== '--settings') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return resolve(settingsCwd, value)
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '{'
    }
    if (!Object.hasOwn(parsed, 'cleanupPeriodDays')) return undefined
    return JSON.stringify({
      cleanupPeriodDays: (parsed as { cleanupPeriodDays?: unknown })
        .cleanupPeriodDays,
    })
  } catch {
    // Preserve fail-closed parsing without forwarding unrelated inline data.
    return '{'
  }
}

export function startBackgroundSessionCleanupWorker(
  options: BackgroundSessionCleanupWorkerStartOptions,
): void {
  const entrypoint = options.entrypoint ?? process.argv[1]
  if (!entrypoint) {
    throw new Error('Background cleanup worker entrypoint is unavailable')
  }
  const workerEnv = { ...(options.env ?? process.env) }
  if (!SAFE_ID_RE.test(options.sessionId)) {
    throw new Error('Invalid background cleanup session ID')
  }
  workerEnv[BACKGROUND_SESSION_ID_ENV] = options.sessionId
  workerEnv[BACKGROUND_SESSION_CLEANUP_WORKER_ENV] = '1'
  workerEnv[BACKGROUND_SESSION_CLEANUP_OWNER_PID_ENV] = String(
    options.ownerPid,
  )
  workerEnv[BACKGROUND_SESSION_LAUNCHER_PID_ENV] = String(options.launcherPid)
  const child = (options.spawnProcess ?? spawn)(
    options.execPath ?? process.execPath,
    [
      ...(options.execArgv ?? process.execArgv),
      entrypoint,
      ...backgroundRetentionSettingsArgs(
        options.settingsArgs ?? process.argv.slice(2),
        options.settingsCwd ?? process.cwd(),
      ),
    ],
    {
      detached: true,
      env: workerEnv,
      stdio: 'ignore',
    },
  )
  child.once('error', () => {})
  child.unref()
}

type RunBackgroundSessionCleanupWorkerOptions = {
  env?: NodeJS.ProcessEnv
  isProcessAlive?: (pid: number) => boolean
  sleep?: (ms: number) => Promise<void>
  waitMs?: number
  pollMs?: number
  cleanup?: (
    sessionId: string,
    waitForProcessesToExit: () => Promise<boolean>,
    reloadSettings?: () => boolean,
  ) => Promise<void>
  reloadSettings?: () => boolean
}

async function runDefaultPostFinalizationCleanup(
  sessionId: string,
  waitForProcessesToExit: () => Promise<boolean>,
  reloadSettings?: () => boolean,
): Promise<void> {
  const { cleanupBackgroundSessionsAfterFinalization } = await import(
    '../utils/cleanup.js'
  )
  await cleanupBackgroundSessionsAfterFinalization(
    sessionId,
    waitForProcessesToExit,
    reloadSettings,
  )
}

export async function runBackgroundSessionCleanupWorker(
  options: RunBackgroundSessionCleanupWorkerOptions = {},
): Promise<void> {
  const env = options.env ?? process.env
  if (env[BACKGROUND_SESSION_CLEANUP_WORKER_ENV] !== '1') return
  const ownerPid = parsePositivePid(
    env[BACKGROUND_SESSION_CLEANUP_OWNER_PID_ENV],
  )
  const launcherPid = parsePositivePid(
    env[BACKGROUND_SESSION_LAUNCHER_PID_ENV],
  )
  const sessionId = env[BACKGROUND_SESSION_ID_ENV]
  delete env[BACKGROUND_SESSION_CLEANUP_WORKER_ENV]
  delete env[BACKGROUND_SESSION_CLEANUP_OWNER_PID_ENV]
  delete env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]
  delete env[BACKGROUND_SESSION_ID_ENV]
  if (
    ownerPid === undefined ||
    launcherPid === undefined ||
    !sessionId ||
    !SAFE_ID_RE.test(sessionId)
  ) {
    return
  }

  const isProcessAlive = options.isProcessAlive ?? isBackgroundLauncherAlive
  const sleep =
    options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const waitMs = options.waitMs ?? DEFAULT_CLEANUP_WORKER_WAIT_MS
  const pollMs = options.pollMs ?? DEFAULT_CLEANUP_WORKER_POLL_MS
  const pids = [...new Set([ownerPid, launcherPid])]
  const waitForProcessesToExit = async (): Promise<boolean> => {
    const attempts = Math.max(1, Math.ceil(waitMs / pollMs))
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (pids.every(pid => !isProcessAlive(pid))) return true
      await sleep(pollMs)
    }
    return pids.every(pid => !isProcessAlive(pid))
  }

  await (options.cleanup ?? runDefaultPostFinalizationCleanup)(
    sessionId,
    waitForProcessesToExit,
    options.reloadSettings,
  )
}

export async function prepareBackgroundSessionFinalizer(
  options: PrepareBackgroundSessionFinalizerOptions = {},
): Promise<BackgroundSessionFinalizerPreparation> {
  const env = options.env ?? process.env
  const id = env[BACKGROUND_SESSION_ID_ENV]
  const launcherPidValue = env[BACKGROUND_SESSION_LAUNCHER_PID_ENV]
  if (id === undefined && launcherPidValue === undefined) {
    return 'not-background'
  }

  const launcherPid = parsePositivePid(launcherPidValue)
  if (!id || !SAFE_ID_RE.test(id) || launcherPid === undefined) {
    scrubRoutingEnvironment(env)
    return 'invalid-routing'
  }

  const ownerPid = options.pid ?? process.pid
  const ownedSession = await waitForOwnedSession(id, ownerPid, launcherPid, {
    readSession: options.readSession ?? readBackgroundSessionForOwner,
    isLauncherAlive: options.isLauncherAlive ?? isBackgroundLauncherAlive,
    sleep:
      options.sleep ??
      (ms => new Promise(resolve => setTimeout(resolve, ms))),
    registrationWaitMs:
      options.registrationWaitMs ?? DEFAULT_REGISTRATION_WAIT_MS,
    registrationPollMs:
      options.registrationPollMs ?? DEFAULT_REGISTRATION_POLL_MS,
  })
  if (ownedSession === 'mismatch') {
    scrubRoutingEnvironment(env)
    return 'invalid-routing'
  }
  if (ownedSession === 'timeout') {
    scrubRoutingEnvironment(env)
    throw new Error('Background session registration was not established')
  }

  scrubRoutingEnvironment(env)
  const finalize =
    options.finalize ?? recordBackgroundSessionNaturalTermination
  const finalizeSync =
    options.finalizeSync ?? recordBackgroundSessionNaturalTerminationSync
  const getObservedSignal =
    options.getObservedSignal ?? beginBackgroundSessionSignalTracking()
  const debug = options.debug ?? defaultDebug
  const retentionSettingsArgs = backgroundRetentionSettingsArgs(
    options.settingsArgs ?? process.argv.slice(2),
    options.settingsCwd ?? process.cwd(),
  )
  const startCleanupWorker =
    options.startCleanupWorker ??
    ((
      cleanupSessionId,
      cleanupOwnerPid,
      cleanupLauncherPid,
      cleanupSettingsArgs,
    ) =>
      startBackgroundSessionCleanupWorker({
        sessionId: cleanupSessionId,
        ownerPid: cleanupOwnerPid,
        launcherPid: cleanupLauncherPid,
        settingsArgs: cleanupSettingsArgs,
      }))
  let finalized = false

  const startPostFinalizationCleanup = () => {
    try {
      startCleanupWorker(
        id,
        ownerPid,
        launcherPid,
        retentionSettingsArgs,
      )
    } catch (error) {
      reportPostFinalizationCleanupFailure(debug, error)
    }
  }

  const currentTermination = () => {
    const signal = getObservedSignal()
    return signal === undefined
      ? { exitCode: currentProcessExitCode() }
      : { signal }
  }

  const finalizeAwaited = async () => {
    if (finalized) return
    try {
      await finalize(id, currentTermination(), {
        ownerPid,
        expectedSession: ownedSession,
      })
      finalized = true
    } catch (error) {
      reportFinalizationFailure(debug, error)
      return
    }
    startPostFinalizationCleanup()
  }
  const registerFinalizerCleanup = options.registerCleanup ?? registerCleanup
  registerFinalizerCleanup(finalizeAwaited)

  if (options.onBeforeExit) {
    options.onBeforeExit(finalizeAwaited)
  } else {
    process.once('beforeExit', finalizeAwaited)
  }

  const onExit = (code: number) => {
    if (finalized) return
    try {
      const signal = getObservedSignal()
      finalizeSync(
        id,
        signal === undefined ? { exitCode: code } : { signal },
        { ownerPid, expectedSession: ownedSession },
      )
      finalized = true
    } catch (error) {
      reportFinalizationFailure(debug, error)
      return
    }
    startPostFinalizationCleanup()
  }
  if (options.onExit) {
    options.onExit(onExit)
  } else {
    const originalExit = process.exit
    process.exit = ((code?: string | number | null) => {
      onExit(normalizeProcessExitCode(code ?? process.exitCode))
      return originalExit(code)
    }) as typeof process.exit
    process.once('exit', onExit)
  }

  return 'installed'
}
