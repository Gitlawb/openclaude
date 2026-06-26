import { randomUUID } from 'crypto'
import { writeToStderr } from 'src/utils/process.js'

export const HEADLESS_HEARTBEAT_MIN_INTERVAL_MS = 5_000
export const HEADLESS_HEARTBEAT_MAX_INTERVAL_MS = 2_147_483_647
const FALLBACK_HEARTBEAT_UUID = '00000000-0000-4000-8000-000000000000'

export type HeadlessHeartbeatPhase =
  | 'startup'
  | 'loading_session'
  | 'connecting_mcp'
  | 'draining_commands'
  | 'in_turn'
  | 'waiting_for_permission'
  | 'waiting_for_agents'
  | 'flushing'
  | 'shutting_down'

export type HeadlessHeartbeatState =
  | 'starting'
  | 'running'
  | 'requires_action'
  | 'idle'
  | 'shutting_down'

type TimerHandle = unknown

export type HeadlessHeartbeatEvent = {
  type: 'system'
  subtype: 'heartbeat'
  timestamp: string
  elapsed_ms: number
  since_last_activity_ms: number
  state: HeadlessHeartbeatState
  phase: HeadlessHeartbeatPhase
  heartbeat_index: number
  pending_permission_requests: number
  background_tasks: Record<string, number>
  uuid: string
  session_id: string
}

type HeadlessHeartbeatOptions = {
  intervalMs: number
  outputFormat?: string
  getSessionId?: () => string | undefined
  getState?: () => HeadlessHeartbeatState
  initialPhase?: HeadlessHeartbeatPhase
  getPendingPermissionRequests?: () => number | readonly unknown[]
  getBackgroundTaskCounts?: () => Record<string, number>
  emitStructured?: (message: HeadlessHeartbeatEvent) => void | Promise<void>
  emitStderr?: (line: string) => void
  now?: () => number
  setInterval?: (callback: () => void, intervalMs: number) => TimerHandle
  clearInterval?: (timer: TimerHandle) => void
  createUuid?: () => string
}

export type HeadlessHeartbeat = {
  start: () => void
  stop: () => void
  markActivity: () => void
  setPhase: (phase: HeadlessHeartbeatPhase) => void
}

export function parseHeadlessHeartbeatDuration(rawValue: string): number {
  const value = rawValue.trim()
  if (/^0+$/.test(value)) {
    throw new Error('--heartbeat must be at least 5s.')
  }
  const match = /^(\d+)(ms|s|m)$/.exec(value)
  if (!match) {
    throw new Error(
      '--heartbeat must be a duration like 30s, 2m, or 5000ms.',
    )
  }

  const unit = match[2]
  const multiplier = unit === 'ms' ? 1n : unit === 's' ? 1_000n : 60_000n
  const intervalMsBigInt = BigInt(match[1]) * multiplier
  if (intervalMsBigInt > BigInt(HEADLESS_HEARTBEAT_MAX_INTERVAL_MS)) {
    throw new Error(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
  }

  const intervalMs = Number(intervalMsBigInt)

  assertValidHeadlessHeartbeatInterval(intervalMs)

  return intervalMs
}

export function createHeadlessHeartbeat(
  options: HeadlessHeartbeatOptions,
): HeadlessHeartbeat {
  assertValidHeadlessHeartbeatInterval(options.intervalMs)
  if (options.outputFormat === 'stream-json' && !options.emitStructured) {
    throw new Error('stream-json heartbeat output requires a structured sink.')
  }

  const now = options.now ?? Date.now
  const scheduleInterval = options.setInterval ?? setInterval
  const clearScheduledInterval =
    options.clearInterval ??
    ((timerHandle: TimerHandle) =>
      clearInterval(timerHandle as ReturnType<typeof setInterval>))
  const createUuid = options.createUuid ?? randomUUID
  const emitStderr =
    options.emitStderr ?? ((line: string) => writeToStderr(`${line}\n`))
  const emitStructured = options.emitStructured
  const initialPhase = options.initialPhase ?? 'startup'

  let timer: TimerHandle | undefined
  let startedAt = now()
  let lastActivityAt = startedAt
  let lastHeartbeatAt = startedAt
  let heartbeatIndex = 0
  let phase = initialPhase

  const armTimer = () => {
    timer = scheduleInterval(emit, options.intervalMs)
    unrefTimer(timer)
  }

  const clearTimer = () => {
    if (timer === undefined) {
      return
    }
    clearScheduledInterval(timer)
    timer = undefined
  }

  const emit = () => {
    const currentTime = now()
    if (currentTime < startedAt) {
      startedAt = currentTime
    }
    if (currentTime < lastActivityAt) {
      lastActivityAt = currentTime - options.intervalMs
    }
    if (currentTime < lastHeartbeatAt) {
      lastHeartbeatAt = currentTime - options.intervalMs
    }

    const sinceLastActivityMs = currentTime - lastActivityAt
    if (sinceLastActivityMs < options.intervalMs) {
      return
    }
    if (currentTime - lastHeartbeatAt < options.intervalMs) {
      return
    }

    heartbeatIndex += 1
    lastHeartbeatAt = currentTime

    const elapsedMs = Math.max(0, currentTime - startedAt)
    const emittedSinceLastActivityMs = Math.max(0, sinceLastActivityMs)
    const state = safelyGet(options.getState, 'running')
    const event: HeadlessHeartbeatEvent = {
      type: 'system',
      subtype: 'heartbeat',
      timestamp: new Date(currentTime).toISOString(),
      elapsed_ms: elapsedMs,
      since_last_activity_ms: emittedSinceLastActivityMs,
      state,
      phase,
      heartbeat_index: heartbeatIndex,
      pending_permission_requests: getPendingPermissionRequestCount(
        safelyGet(options.getPendingPermissionRequests, undefined),
      ),
      background_tasks: sanitizeBackgroundTaskCounts(
        safelyGet(options.getBackgroundTaskCounts, {}),
      ),
      uuid: safelyGet(createUuid, FALLBACK_HEARTBEAT_UUID),
      session_id: safelyGet(options.getSessionId, '') ?? '',
    }

    if (options.outputFormat === 'stream-json') {
      try {
        void Promise.resolve(emitStructured?.(event)).catch(() => {})
      } catch {
        // Broken pipes or closed transports should not keep the process alive.
      }
      return
    }

    try {
      emitStderr(formatStderrHeartbeat(event))
    } catch {
      // Broken pipes or closed stderr should not keep the process alive.
    }
  }

  return {
    start() {
      if (timer !== undefined) {
        return
      }
      startedAt = now()
      lastActivityAt = startedAt
      lastHeartbeatAt = startedAt
      heartbeatIndex = 0
      phase = initialPhase
      armTimer()
    },
    stop() {
      clearTimer()
    },
    markActivity() {
      const currentTime = now()
      lastActivityAt = currentTime
      lastHeartbeatAt = currentTime
      if (timer !== undefined) {
        clearTimer()
        armTimer()
      }
    },
    setPhase(nextPhase: HeadlessHeartbeatPhase) {
      phase = nextPhase
    },
  }
}

function unrefTimer(timer: TimerHandle): void {
  if (
    timer !== undefined &&
    timer !== null &&
    typeof timer === 'object' &&
    'unref' in timer &&
    typeof timer.unref === 'function'
  ) {
    timer.unref()
  }
}

function safelyGet<T>(getter: (() => T) | undefined, fallback: T): T {
  if (!getter) {
    return fallback
  }
  try {
    return getter()
  } catch {
    return fallback
  }
}

export function isHeadlessHeartbeatMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false
  }
  const candidate = message as { type?: unknown; subtype?: unknown }
  return candidate.type === 'system' && candidate.subtype === 'heartbeat'
}

export function validateHeadlessHeartbeatPrintMode(
  intervalMs: number | undefined,
  hasPrintFlag: boolean,
): void {
  if (intervalMs !== undefined && !hasPrintFlag) {
    throw new Error('--heartbeat can only be used with --print.')
  }
}

export function shouldSelectHeadlessFinalMessage(
  message: unknown,
): boolean {
  if (
    !message ||
    typeof message !== 'object' ||
    typeof (message as { type?: unknown }).type !== 'string'
  ) {
    return false
  }

  const candidate = message as { type: string; subtype?: unknown }
  return (
    candidate.type !== 'control_response' &&
    candidate.type !== 'control_request' &&
    candidate.type !== 'control_cancel_request' &&
    !(
      candidate.type === 'system' &&
      (candidate.subtype === 'session_state_changed' ||
        candidate.subtype === 'task_notification' ||
        candidate.subtype === 'task_started' ||
        candidate.subtype === 'task_progress' ||
        candidate.subtype === 'heartbeat' ||
        candidate.subtype === 'post_turn_summary' ||
        candidate.subtype === 'files_persisted')
    ) &&
    candidate.type !== 'stream_event' &&
    candidate.type !== 'keep_alive' &&
    candidate.type !== 'streamlined_text' &&
    candidate.type !== 'streamlined_tool_use_summary' &&
    candidate.type !== 'prompt_suggestion'
  )
}

function assertValidHeadlessHeartbeatInterval(intervalMs: number): void {
  if (!Number.isFinite(intervalMs) || !Number.isInteger(intervalMs)) {
    throw new Error('--heartbeat must be at least 5s.')
  }
  if (intervalMs < HEADLESS_HEARTBEAT_MIN_INTERVAL_MS) {
    throw new Error('--heartbeat must be at least 5s.')
  }
  if (!Number.isSafeInteger(intervalMs)) {
    throw new Error(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
  }
  if (intervalMs > HEADLESS_HEARTBEAT_MAX_INTERVAL_MS) {
    throw new Error(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
  }
}

function getPendingPermissionRequestCount(
  value: number | readonly unknown[] | undefined,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  return Array.isArray(value) ? value.length : 0
}

function sanitizeBackgroundTaskCounts(
  counts: Record<string, number>,
): Record<string, number> {
  const sanitized: Record<string, number> = {}
  for (const [type, count] of Object.entries(counts)) {
    if (!Number.isFinite(count)) {
      continue
    }
    const normalizedCount = Math.trunc(count)
    if (normalizedCount <= 0) {
      continue
    }
    sanitized[type] = normalizedCount
  }
  return sanitized
}

function formatStderrHeartbeat(event: {
  elapsed_ms: number
  since_last_activity_ms: number
  state: HeadlessHeartbeatState
  phase: HeadlessHeartbeatPhase
  session_id: string
}): string {
  const parts = [
    'openclaude: heartbeat',
    `elapsed=${formatSeconds(event.elapsed_ms)}`,
    `quiet=${formatSeconds(event.since_last_activity_ms)}`,
    `state=${event.state}`,
    `phase=${event.phase}`,
  ]
  if (event.session_id) {
    parts.push(`session=${event.session_id}`)
  }
  return parts.join(' ')
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1_000
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`
}
