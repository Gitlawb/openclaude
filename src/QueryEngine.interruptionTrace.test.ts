import { afterEach, describe, expect, test } from 'bun:test'
import { QueryEngine } from './QueryEngine.js'
import {
  __getInterruptionTraceSnapshotForTests,
  __resetInterruptionTraceForTests,
  __waitForInterruptionTraceFlushForTests,
} from './utils/interruptionTrace.js'

const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE

afterEach(async () => {
  await __waitForInterruptionTraceFlushForTests()
  __resetInterruptionTraceForTests()
  if (originalTrace === undefined) delete process.env.OPENCLAUDE_INTERRUPT_TRACE
  else process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
})

describe('QueryEngine interruption tracing', () => {
  test('records a programmatic query-root interruption before aborting', () => {
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    const controller = new AbortController()
    const engine = Object.create(QueryEngine.prototype) as QueryEngine
    ;(engine as unknown as {
      abortController: AbortController
    }).abortController = controller

    engine.interrupt('sdk_interrupt')

    const requested = __getInterruptionTraceSnapshotForTests().find(
      entry => entry.event === 'abort.requested',
    )
    expect(controller.signal.aborted).toBe(true)
    expect(requested).toMatchObject({
      source: 'sdk_interrupt',
      subsystem: 'query_engine',
      controllerRole: 'query-root',
    })
  })
})
