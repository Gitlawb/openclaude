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
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
} from './bgRouting.js'

export {
  BACKGROUND_SESSION_ID_ENV,
  BACKGROUND_SESSION_LAUNCHER_PID_ENV,
} from './bgRouting.js'

const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/
const DEFAULT_REGISTRATION_WAIT_MS = 5_000
const DEFAULT_REGISTRATION_POLL_MS = 10

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

function currentProcessExitCode(): number {
  const value = process.exitCode
  if (value === undefined) return 0
  const parsed =
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof parsed === 'number' &&
    Number.isSafeInteger(parsed) &&
    parsed >= 0
    ? parsed
    : 1
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
): Promise<'owned' | 'mismatch' | 'timeout'> {
  const attempts = Math.max(
    1,
    Math.ceil(options.registrationWaitMs / options.registrationPollMs),
  )
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await options.readSession(id)
    if (session) return session.pid === ownerPid ? 'owned' : 'mismatch'
    if (!options.isLauncherAlive(launcherPid)) {
      const finalSession = await options.readSession(id)
      if (finalSession) {
        return finalSession.pid === ownerPid ? 'owned' : 'mismatch'
      }
      return 'timeout'
    }
    await options.sleep(options.registrationPollMs)
  }
  const session = await options.readSession(id)
  if (session) return session.pid === ownerPid ? 'owned' : 'mismatch'
  return 'timeout'
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
  const ownership = await waitForOwnedSession(id, ownerPid, launcherPid, {
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
  if (ownership === 'mismatch') {
    scrubRoutingEnvironment(env)
    return 'invalid-routing'
  }
  if (ownership === 'timeout') {
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
  let finalized = false

  const currentTermination = () => {
    const signal = getObservedSignal()
    return signal === undefined
      ? { exitCode: currentProcessExitCode() }
      : { signal }
  }

  const finalizeAwaited = async () => {
    if (finalized) return
    try {
      await finalize(id, currentTermination(), { ownerPid })
      finalized = true
    } catch (error) {
      reportFinalizationFailure(debug, error)
    }
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
        { ownerPid },
      )
      finalized = true
    } catch (error) {
      reportFinalizationFailure(debug, error)
    }
  }
  if (options.onExit) {
    options.onExit(onExit)
  } else {
    process.once('exit', onExit)
  }

  return 'installed'
}
