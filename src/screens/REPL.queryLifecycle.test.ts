import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

describe('REPL query lifecycle timeout logging', () => {
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
})
