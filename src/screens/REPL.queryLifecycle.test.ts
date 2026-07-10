import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InterruptionCorrectionTracker } from '../utils/interruptionCorrection.js'
import { QueryGuard } from '../utils/QueryGuard.js'

const source = readFileSync(join(import.meta.dirname, 'REPL.tsx'), 'utf8')

function getAbortTimedOutQueryBody(): string {
  const start = source.indexOf('const abortTimedOutQuery = useCallback')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('}, [mrOnTurnComplete, resetLoadingState])', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function getQueryFinallyBody(): string {
  const queryStart = source.indexOf('await onQueryImpl(')
  expect(queryStart).toBeGreaterThan(-1)
  const finallyStart = source.indexOf('} finally {', queryStart)
  expect(finallyStart).toBeGreaterThan(queryStart)
  const finallyEnd = source.indexOf('// Auto-restore:', finallyStart)
  expect(finallyEnd).toBeGreaterThan(finallyStart)
  return source.slice(finallyStart, finallyEnd)
}

function getOnCancelBody(): string {
  const start = source.indexOf('function onCancel(')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf(
    'const handleQueuedCommandOnCancel = useCallback',
    start,
  )
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('REPL query lifecycle timeout logging', () => {
  test('constructs QueryGuard with resolved hard max config', () => {
    expect(source).toContain(
      "import { getQueryGuardOptionsFromEnv } from '../utils/queryGuardConfig.js'",
    )
    expect(source).toContain('new QueryGuard(getQueryGuardOptionsFromEnv())')
  })

  test('does not emit terminal timeout end from timeout handler', () => {
    const body = getAbortTimedOutQueryBody()
    const queueMicrotaskIndex = body.indexOf('queueMicrotask(() => {')
    expect(queueMicrotaskIndex).toBeGreaterThan(-1)

    const abortAcknowledgedIndex = body.indexOf(
      "logQueryLifecycle('abort_acknowledged'",
      queueMicrotaskIndex,
    )

    expect(abortAcknowledgedIndex).toBeGreaterThan(queueMicrotaskIndex)
    expect(body).not.toContain("logQueryLifecycle('end'")
  })

  test('emits timeout end from the query finally cleanup path', () => {
    const body = getQueryFinallyBody()

    expect(body).toContain('const guardCompletedContext = queryGuard.lastContext')
    expect(body).toContain("guardCompletedContext?.terminalReason === 'query-timeout'")
    expect(body).toContain("guardCompletedContext?.terminalReason === 'hard-max-query-timeout'")
    expect(body).toContain('guardCompletedContext.queryGeneration === thisGeneration')
    expect(body).toContain('logCompletedLifecycle(guardCompletedContext)')
  })

  test('wires the correction tracker to local model-turn cancellation', () => {
    expect(source).toContain(
      'const interruptionCorrectionTrackerRef = useRef<InterruptionCorrectionTracker | null>(null)',
    )
    expect(source).toContain(
      'new InterruptionCorrectionTracker(queryGuard, getSessionId)',
    )

    const onCancelBody = getOnCancelBody()
    expect(onCancelBody).toContain('.handleCancellation({')
    expect(onCancelBody).toContain('isUserInitiated')
    expect(onCancelBody).toContain('activeRemote.isRemoteMode')
    expect(source).toContain('onCancel: () => onCancel(true)')

    const reminderHookOccurrences =
      source.match(/takeInterruptionCorrectionReminder/g)?.length ?? 0
    expect(reminderHookOccurrences).toBeGreaterThanOrEqual(3)
  })

  test('marks model ownership only after pre-query callbacks approve', () => {
    const onQueryStart = source.indexOf('const onQuery = useCallback')
    const approvalIndex = source.indexOf(
      'const shouldProceed = await onBeforeQueryCallback',
      onQueryStart,
    )
    const ownershipIndex = source.indexOf(
      'interruptionCorrectionTrackerRef.current.bindModelTurn({',
      onQueryStart,
    )
    const modelExecutionIndex = source.indexOf(
      'await onQueryImpl(',
      onQueryStart,
    )

    expect(approvalIndex).toBeGreaterThan(onQueryStart)
    expect(ownershipIndex).toBeGreaterThan(approvalIndex)
    expect(modelExecutionIndex).toBeGreaterThan(ownershipIndex)
    expect(source).toContain(
      'interruptionCorrectionTrackerRef.current.finishModelTurn(queryContext.queryId)',
    )
  })

  test('executes correction arming and consumption through QueryGuard', () => {
    const queryGuard = new QueryGuard()
    let sessionId = 'session-a'
    const tracker = new InterruptionCorrectionTracker(
      queryGuard,
      () => sessionId,
    )

    const localCommand = queryGuard.tryStart({
      queryId: 'local-command',
      querySource: 'repl_main_thread',
      startedAt: 1,
    })!
    tracker.bindModelTurn({
      shouldQuery: false,
      isAborted: false,
      queryId: localCommand.context.queryId,
    })
    tracker.handleCancellation({
      isUserInitiated: true,
      isRemoteMode: false,
    })
    queryGuard.forceEnd('user-abort', 'user-cancel')
    expect(tracker.takeReminder()).toBeNull()

    const modelTurn = queryGuard.tryStart({
      queryId: 'model-turn',
      querySource: 'repl_main_thread',
      startedAt: 2,
    })!
    tracker.bindModelTurn({
      shouldQuery: true,
      isAborted: false,
      queryId: modelTurn.context.queryId,
    })
    tracker.handleCancellation({
      isUserInitiated: true,
      isRemoteMode: false,
    })
    queryGuard.forceEnd('user-abort', 'user-cancel')

    expect(tracker.takeReminder()).toMatchObject({
      type: 'user',
      isMeta: true,
    })
    expect(tracker.takeReminder()).toBeNull()

    sessionId = 'session-b'
    expect(tracker.takeReminder()).toBeNull()
  })
})
