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

describe('REPL query lifecycle timeout logging', () => {
  test('logs timeout end only after abort acknowledgement', () => {
    const body = getAbortTimedOutQueryBody()
    const queueMicrotaskIndex = body.indexOf('queueMicrotask(() => {')
    expect(queueMicrotaskIndex).toBeGreaterThan(-1)
    const beforeAcknowledgement = body.slice(0, queueMicrotaskIndex)
    expect(beforeAcknowledgement).not.toContain("logQueryLifecycle('end'")

    const abortAcknowledgedIndex = body.indexOf(
      "logQueryLifecycle('abort_acknowledged'",
      queueMicrotaskIndex,
    )
    const endIndex = body.indexOf(
      "logQueryLifecycle('end'",
      queueMicrotaskIndex,
    )

    expect(abortAcknowledgedIndex).toBeGreaterThan(queueMicrotaskIndex)
    expect(endIndex).toBeGreaterThan(abortAcknowledgedIndex)
  })
})
