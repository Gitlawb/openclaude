import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  monitorEventLoopDelay,
  type IntervalHistogram,
} from 'node:perf_hooks'
import { normalizeAbortReason } from './abortReasons.js'
import { appendDiagnosticsNoPII } from './diagLogs.js'

const TRACE_CAPACITY = 512
const TRACE_SCHEMA_VERSION = 1
const TRACE_ENABLED_ENV = 'OPENCLAUDE_INTERRUPT_TRACE'
const TRACE_FILE_ENV = 'OPENCLAUDE_INTERRUPT_TRACE_FILE'

export type InterruptionTraceFields = {
  source?: string
  subsystem?: string
  phase?: string
  queryId?: string
  queryGeneration?: number
  querySource?: string
  parentQueryId?: string
  subagentId?: string
  providerRoute?: string
  transport?: string
  model?: string
  attemptId?: string
  controllerRole?: string
  parentControllerIds?: readonly string[]
  winningParentControllerId?: string
  causalEventId?: string
  trigger?: string
  outcome?: string
  reason?: unknown
  existingReason?: unknown
  attemptedReason?: unknown
  error?: unknown
  elapsedQueryMs?: number
  sinceLastActivityMs?: number
  sinceLastRawByteMs?: number
  sinceLastParsedFrameMs?: number
  sinceLastYieldMs?: number
  rawByteCount?: number
  parsedFrameCount?: number
  ignoredFrameCount?: number
  yieldedEventCount?: number
  activeApiCallCount?: number
  activeToolUseCount?: number
  leaseCount?: number
  suspendCount?: number
  repeatedCount?: number
  eventLoopDelayMaxMs?: number
  eventLoopDelayMeanMs?: number
}

type SafeTraceFields = Omit<
  InterruptionTraceFields,
  'reason' | 'error' | 'parentControllerIds'
> & {
  normalizedReason?: string
  rawReasonType?: string
  existingNormalizedReason?: string
  existingRawReasonType?: string
  attemptedNormalizedReason?: string
  attemptedRawReasonType?: string
  safeErrorIdentity?: string
  parentControllerIds?: string[]
}

export type InterruptionTraceEntry = SafeTraceFields & {
  schemaVersion: number
  sequence: number
  eventId: string
  traceSessionId: string
  timestamp: string
  monotonicMs: number
  clockDeltaMs: number
  event: string
  controllerId?: string
  firstAbortEventId?: string
  abortStackFingerprint?: string
  abortCallSites?: string[]
}

type ControllerTraceState = {
  id: string
  firstAbortEventId?: string
  repeatedCount: number
  fields: InterruptionTraceFields
}

let traceSessionId = ''
let sequence = 0
let startedWallMs = Date.now()
let startedMonotonicMs = performance.now()
let ring: InterruptionTraceEntry[] = []
let flushedThroughSequence = 0
let controllerCounter = 0
let signalCounter = 0
let controllerStates = new WeakMap<AbortController, ControllerTraceState>()
let signalIds = new WeakMap<AbortSignal, string>()
let signalAbortEventIds = new WeakMap<AbortSignal, string>()
let eventLoopDelay: IntervalHistogram | undefined

function isEnabled(): boolean {
  const value = process.env[TRACE_ENABLED_ENV]?.toLowerCase()
  return value === '1' || value === 'true'
}

export function isInterruptionTraceEnabled(): boolean {
  return isEnabled()
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const clipped = value.slice(0, 160)
  if (
    /(?:bearer\s+|sk-[a-z0-9_-]{8,}|password|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)/i.test(
      clipped,
    ) ||
    /(?:^|[=:,\s])(?:[a-z]:\\|\/(?!\/))/i.test(clipped)
  ) {
    return '[redacted]'
  }
  return clipped
}

function safeEventName(value: string): string {
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value) ? value : 'unknown'
}

function safeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getRawReasonType(reason: unknown): string {
  if (reason === null) return 'null'
  if (reason instanceof DOMException) return `DOMException:${safeString(reason.name) ?? 'unknown'}`
  if (reason instanceof Error) return `Error:${safeString(reason.name) ?? 'unknown'}`
  if (Array.isArray(reason)) return 'array'
  return typeof reason
}

function getSafeErrorIdentity(error: unknown): string | undefined {
  if (error instanceof DOMException) return `DOMException:${safeString(error.name) ?? 'unknown'}`
  if (error instanceof Error) return safeString(error.name) ?? 'Error'
  return error === undefined ? undefined : typeof error
}

function toSafeFields(fields: InterruptionTraceFields): SafeTraceFields {
  const reason = fields.reason
  const safe: SafeTraceFields = {}
  const stringFields = [
    'source',
    'subsystem',
    'phase',
    'queryId',
    'querySource',
    'parentQueryId',
    'subagentId',
    'providerRoute',
    'transport',
    'model',
    'attemptId',
    'controllerRole',
    'winningParentControllerId',
    'causalEventId',
    'trigger',
    'outcome',
  ] as const
  for (const key of stringFields) {
    const value = safeString(fields[key])
    if (value !== undefined) safe[key] = value
  }
  const numberFields = [
    'queryGeneration',
    'elapsedQueryMs',
    'sinceLastActivityMs',
    'sinceLastRawByteMs',
    'sinceLastParsedFrameMs',
    'sinceLastYieldMs',
    'rawByteCount',
    'parsedFrameCount',
    'ignoredFrameCount',
    'yieldedEventCount',
    'activeApiCallCount',
    'activeToolUseCount',
    'leaseCount',
    'suspendCount',
    'repeatedCount',
    'eventLoopDelayMaxMs',
    'eventLoopDelayMeanMs',
  ] as const
  for (const key of numberFields) {
    const value = safeFiniteNumber(fields[key])
    if (value !== undefined) safe[key] = value
  }
  if (fields.parentControllerIds) {
    safe.parentControllerIds = fields.parentControllerIds
      .map(safeString)
      .filter((value): value is string => value !== undefined)
      .slice(0, 4)
  }
  if (reason !== undefined) {
    safe.normalizedReason = normalizeAbortReason(reason)
    safe.rawReasonType = getRawReasonType(reason)
  }
  if (fields.existingReason !== undefined) {
    safe.existingNormalizedReason = normalizeAbortReason(fields.existingReason)
    safe.existingRawReasonType = getRawReasonType(fields.existingReason)
  }
  if (fields.attemptedReason !== undefined) {
    safe.attemptedNormalizedReason = normalizeAbortReason(
      fields.attemptedReason,
    )
    safe.attemptedRawReasonType = getRawReasonType(fields.attemptedReason)
  }
  const safeErrorIdentity = getSafeErrorIdentity(fields.error)
  if (safeErrorIdentity !== undefined) safe.safeErrorIdentity = safeErrorIdentity
  return safe
}

function getAbortStackEvidence(): {
  abortStackFingerprint?: string
  abortCallSites?: string[]
} {
  const rawStack = new Error().stack
  if (!rawStack) return {}
  const sites = rawStack
    .split('\n')
    .slice(2, 7)
    .map(line => {
      const functionMatch = line.match(/^\s*at\s+([^\s(]+)/)
      const candidate = safeString(functionMatch?.[1])
      return candidate && !/[\\/:]/.test(candidate)
        ? candidate
        : '<anonymous>'
    })
  const fingerprint = createHash('sha256').update(sites.join('>')).digest('hex').slice(0, 16)
  return { abortStackFingerprint: fingerprint, abortCallSites: sites }
}

function addEntry(
  event: string,
  fields: InterruptionTraceFields,
  extra: Partial<InterruptionTraceEntry> = {},
): InterruptionTraceEntry | undefined {
  if (!isEnabled()) return undefined
  if (!traceSessionId) traceSessionId = randomUUID()
  if (!eventLoopDelay) {
    eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
    eventLoopDelay.enable()
  }
  const monotonicMs = performance.now() - startedMonotonicMs
  const wallElapsedMs = Date.now() - startedWallMs
  const nextSequence = ++sequence
  const entry: InterruptionTraceEntry = {
    schemaVersion: TRACE_SCHEMA_VERSION,
    sequence: nextSequence,
    eventId: `${traceSessionId}:${nextSequence}`,
    traceSessionId,
    timestamp: new Date().toISOString(),
    monotonicMs,
    clockDeltaMs: wallElapsedMs - monotonicMs,
    event: safeEventName(event),
    ...toSafeFields({
      ...fields,
      eventLoopDelayMaxMs: Number.isFinite(eventLoopDelay.max)
        ? eventLoopDelay.max / 1_000_000
        : 0,
      eventLoopDelayMeanMs: Number.isFinite(eventLoopDelay.mean)
        ? eventLoopDelay.mean / 1_000_000
        : 0,
    }),
    ...extra,
  }
  ring.push(entry)
  if (ring.length > TRACE_CAPACITY) ring = ring.slice(-TRACE_CAPACITY)
  return entry
}

export function traceInterruptionEvent(
  event: string,
  fields: InterruptionTraceFields = {},
): string | undefined {
  return addEntry(event, fields)?.eventId
}

export function registerInterruptionController(
  controller: AbortController,
  fields: InterruptionTraceFields = {},
): string | undefined {
  if (!isEnabled()) return undefined
  const existing = controllerStates.get(controller)
  if (existing) {
    existing.fields = { ...existing.fields, ...fields }
    return existing.id
  }

  const id = `controller-${++controllerCounter}`
  controllerStates.set(controller, { id, repeatedCount: 0, fields })
  signalIds.set(controller.signal, id)
  addEntry('controller.registered', fields, { controllerId: id })
  controller.signal.addEventListener(
    'abort',
    () => {
      const state = controllerStates.get(controller)
      addEntry(
        'signal.observed',
        { ...state?.fields, reason: controller.signal.reason },
        {
          controllerId: id,
          ...(state?.firstAbortEventId && {
            firstAbortEventId: state.firstAbortEventId,
          }),
        },
      )
    },
    { once: true },
  )
  return id
}

export function getInterruptionSignalId(signal: AbortSignal): string | undefined {
  return isEnabled() ? signalIds.get(signal) : undefined
}

export function getInterruptionSignalAbortEventId(
  signal: AbortSignal,
): string | undefined {
  return isEnabled() ? signalAbortEventIds.get(signal) : undefined
}

export function registerInterruptionSignal(
  signal: AbortSignal,
  fields: InterruptionTraceFields = {},
): string | undefined {
  if (!isEnabled()) return undefined
  const existing = signalIds.get(signal)
  if (existing) return existing
  const id = `signal-${++signalCounter}`
  signalIds.set(signal, id)
  addEntry('signal.registered', fields, { controllerId: id })
  return id
}

export function requestAbort(
  controller: AbortController,
  reason: unknown,
  fields: InterruptionTraceFields,
): void {
  if (!isEnabled()) {
    controller.abort(reason)
    return
  }

  const controllerId =
    registerInterruptionController(controller, fields) ?? 'controller-unknown'
  const state = controllerStates.get(controller)!
  if (controller.signal.aborted) {
    state.repeatedCount++
    addEntry(
      'abort.repeated',
      {
        ...fields,
        existingReason: controller.signal.reason,
        attemptedReason: reason,
        outcome: 'ignored_first_abort_wins',
        repeatedCount: state.repeatedCount,
      },
      {
        controllerId,
        ...(state.firstAbortEventId && {
          firstAbortEventId: state.firstAbortEventId,
        }),
      },
    )
    controller.abort(reason)
    return
  }

  const entry = addEntry(
    'abort.requested',
    { ...fields, reason },
    { controllerId, ...getAbortStackEvidence() },
  )
  if (entry) {
    state.firstAbortEventId = entry.eventId
    signalAbortEventIds.set(controller.signal, entry.eventId)
  }
  controller.abort(reason)
  if (
    fields.controllerRole === 'query-root' ||
    state.fields.controllerRole === 'query-root'
  ) {
    flushInterruptionTrace('root_abort_observed')
  }
}

export function traceCombinedSignal(
  combinedController: AbortController,
  parents: readonly (AbortSignal | undefined)[],
  fields: InterruptionTraceFields = {},
): string | undefined {
  if (!isEnabled()) return undefined
  const parentControllerIds = parents
    .map(parent =>
      parent
        ? registerInterruptionSignal(parent, {
            subsystem: fields.subsystem,
            controllerRole: 'combined-parent',
          })
        : undefined,
    )
    .filter((value): value is string => value !== undefined)
  return registerInterruptionController(combinedController, {
    ...fields,
    parentControllerIds,
  })
}

export function flushInterruptionTrace(trigger: string): void {
  if (!isEnabled()) return
  const logFile = process.env[TRACE_FILE_ENV]
  if (!logFile || !isAbsolute(logFile)) return
  const pending = ring.filter(entry => entry.sequence > flushedThroughSequence)
  if (pending.length === 0) return
  addEntry('trace.flush', { trigger, repeatedCount: pending.length })
  const batch = ring.filter(entry => entry.sequence > flushedThroughSequence)
  appendDiagnosticsNoPII(logFile, batch)
  flushedThroughSequence = batch.at(-1)?.sequence ?? flushedThroughSequence
}

export function __getInterruptionTraceSnapshotForTests(): readonly InterruptionTraceEntry[] {
  return [...ring]
}

export function __resetInterruptionTraceForTests(): void {
  traceSessionId = ''
  sequence = 0
  startedWallMs = Date.now()
  startedMonotonicMs = performance.now()
  ring = []
  flushedThroughSequence = 0
  controllerCounter = 0
  signalCounter = 0
  controllerStates = new WeakMap()
  signalIds = new WeakMap()
  signalAbortEventIds = new WeakMap()
  eventLoopDelay?.disable()
  eventLoopDelay = undefined
}
