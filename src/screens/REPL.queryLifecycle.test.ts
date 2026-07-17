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

function getOnQueryImplBody(): string {
  const start = source.indexOf('const onQueryImpl = useCallback')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('const onQuery = useCallback', start)
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

  test('clears interruption-correction state before resuming another session', () => {
    const switchSessionIndex = source.indexOf('switchSession(asSessionId(sessionId)')
    const sessionChangeIndex = source.indexOf(
      'interruptionCorrectionTracker.handleSessionChange()',
    )
    expect(switchSessionIndex).toBeGreaterThan(-1)
    expect(sessionChangeIndex).toBeGreaterThan(-1)
    expect(sessionChangeIndex).toBeLessThan(switchSessionIndex)
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

  test('keeps correction ownership through post-response tool work', () => {
    const impl = getOnQueryImplBody()
    const finallyBody = getQueryFinallyBody()

    expect(impl).not.toContain('onModelRequestEnd: interruptionCorrectionQueryId')
    expect(finallyBody).toContain(
      'interruptionCorrectionTracker.finishModelTurn(queryContext.queryId)',
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
      isInterruptionCorrectionEligible: true,
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
      isInterruptionCorrectionEligible: true,
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

    const sessionScopedTurn = queryGuard.tryStart({
      queryId: 'session-scoped-turn',
      querySource: 'repl_main_thread',
      startedAt: 3,
    })!
    tracker.bindModelTurn({
      shouldQuery: true,
      isInterruptionCorrectionEligible: true,
      queryId: sessionScopedTurn.context.queryId,
    })
    tracker.handleCancellation({
      isUserInitiated: true,
      isRemoteMode: false,
    })
    queryGuard.forceEnd('user-abort', 'user-cancel')

    sessionId = 'session-b'
    expect(tracker.takeReminder()).toBeNull()
  })

  test('does not arm when the model turn is marked ineligible', async () => {
    const queryGuard = new QueryGuard()
    const tracker = new InterruptionCorrectionTracker(
      queryGuard,
      () => 'session-a',
    )
    const modelTurn = queryGuard.tryStart({
      queryId: 'remote-origin-turn',
      querySource: 'repl_main_thread',
      startedAt: 1,
    })!

    await tracker.runModelTurn({
      shouldQuery: true,
      isInterruptionCorrectionEligible: false,
      queryId: modelTurn.context.queryId,
      run: async () => {
        tracker.handleCancellation({
          isUserInitiated: true,
          isRemoteMode: false,
        })
        queryGuard.forceEnd('user-abort', 'user-cancel')
      },
    })

    expect(tracker.takeReminder()).toBeNull()
  })

})
