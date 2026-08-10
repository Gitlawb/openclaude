import { describe, expect, test } from 'bun:test'
import type { AnthropicStreamEvent } from './codexShim.js'
import {
  __codexStreamToAnthropicForTests,
  codexStreamToAnthropic,
} from './codexShim.js'
import { QueryGuard, type QueryGuardTimeoutReason } from '../../utils/QueryGuard.js'
import type { QueryGuardTimeoutInfo } from '../../utils/queryLifecycle.js'
import { driveQueryEvents } from '../../utils/queryEventDriver.js'
import {
  __getInterruptionTraceSnapshotForTests,
  __resetInterruptionTraceForTests,
  __waitForInterruptionTraceFlushForTests,
  requestAbort,
} from '../../utils/interruptionTrace.js'

async function bounded<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('issue-1830 test did not settle')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function makeTimedStream(
  makeFrame: (index: number) => string,
  intervalMs: number,
): {
  response: Response
  cancelReasons: unknown[]
  getEmissionCount: () => number
  stop: () => void
} {
  const cancelReasons: unknown[] = []
  const encoder = new TextEncoder()
  let index = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let stopped = false
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      timer = setInterval(() => {
        if (stopped) return
        try {
          controller.enqueue(encoder.encode(makeFrame(index++)))
        } catch {
          stopped = true
        }
      }, intervalMs)
    },
    cancel(reason) {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      cancelReasons.push(reason)
    },
  })
  return {
    response: new Response(stream),
    cancelReasons,
    getEmissionCount: () => index,
    stop: () => {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      try {
        streamController?.close()
      } catch {
        // The production reader may already have cancelled the stream.
      }
    },
  }
}

async function driveWithGuard(
  response: Response,
  options: {
    idleTimeoutMs: number
    hardMaxQueryMs: number
    readerIdleTimeoutMs: number
  },
): Promise<{
  events: AnthropicStreamEvent[]
  timeout: QueryGuardTimeoutInfo
  result: { status: 'resolved' } | { status: 'rejected'; error: unknown }
  signalReason: unknown
}> {
  const controller = new AbortController()
  const guard = new QueryGuard(options)
  const start = guard.tryStart({
    queryId: 'issue-1830-query',
    querySource: 'issue-1830-test',
  })
  if (!start) throw new Error('QueryGuard did not start')
  let timeout: QueryGuardTimeoutInfo | undefined
  guard.setTimeoutHandler(info => {
    timeout = info
    requestAbort(controller, info.context.terminalReason, {
      source: 'query_guard',
      subsystem: 'issue_1830_test',
      controllerRole: 'query-root',
      causalEventId: info.causalEventId,
    })
  })
  const events: AnthropicStreamEvent[] = []
  const stream = __codexStreamToAnthropicForTests(
    response,
    'gpt-test',
    controller.signal,
    { idleTimeoutMs: options.readerIdleTimeoutMs },
  )
  try {
    const result = await bounded(
      driveQueryEvents(
        stream,
        reason => guard.registerActivity(reason, start.generation),
        event => events.push(event),
      ).then(
        () => ({ status: 'resolved' as const }),
        error => ({ status: 'rejected' as const, error }),
      ),
    )
    if (!timeout) throw new Error('QueryGuard did not own the terminal decision')
    return { events, timeout, result, signalReason: controller.signal.reason }
  } finally {
    if (!controller.signal.aborted) {
      requestAbort(controller, 'test-cleanup', {
        source: 'issue_1830_test_cleanup',
        subsystem: 'issue_1830_test',
        controllerRole: 'query-root',
      })
    }
    guard.forceEnd('unknown', 'test-cleanup')
    await bounded(stream.return(undefined), 100).catch(() => {})
  }
}

describe('issue #1830 Codex interruption ownership', () => {
  test('raw transport silence is owned by the Codex reader deadline', async () => {
    const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    __resetInterruptionTraceForTests()
    const cancelReasons: unknown[] = []
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelReasons.push(reason)
        },
      }),
    )
    const iterator = __codexStreamToAnthropicForTests(
      response,
      'gpt-test',
      undefined,
      { idleTimeoutMs: 25 },
    )[Symbol.asyncIterator]()

    try {
      expect((await bounded(iterator.next())).value?.type).toBe('message_start')
      const result = await bounded(
        iterator.next().then(
          value => ({ status: 'resolved' as const, value }),
          error => ({ status: 'rejected' as const, error }),
        ),
      )

      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect((result.error as Error).message).toContain(
          'Codex SSE stream idle',
        )
      }
      expect(cancelReasons).toHaveLength(1)
      const trace = __getInterruptionTraceSnapshotForTests()
      const idleTimeout = trace.find(
        entry => entry.event === 'codex_stream.idle_timeout',
      )
      const readerError = trace.find(
        entry => entry.event === 'codex_stream.error',
      )
      const readerCancelled = trace.find(
        entry => entry.event === 'codex_stream.cancelled',
      )
      const converterClosed = trace.find(
        entry => entry.event === 'codex_stream.converter_closed',
      )
      expect(idleTimeout).toBeDefined()
      expect(readerError).toBeDefined()
      expect(readerCancelled).toBeDefined()
      expect(converterClosed).toBeDefined()
      expect(typeof idleTimeout!.eventId).toBe('string')
      expect(typeof readerError!.causalEventId).toBe('string')
      expect(typeof readerCancelled!.causalEventId).toBe('string')
      expect(typeof converterClosed!.causalEventId).toBe('string')
      expect(readerError!.causalEventId).toBe(idleTimeout!.eventId)
      expect(readerCancelled!.causalEventId).toBe(idleTimeout!.eventId)
      expect(converterClosed!.causalEventId).toBe(idleTimeout!.eventId)
    } finally {
      const returned = iterator.return?.(undefined)
      if (returned) await bounded(Promise.resolve(returned), 100).catch(() => {})
      await __waitForInterruptionTraceFlushForTests()
      __resetInterruptionTraceForTests()
      if (originalTrace === undefined) {
        delete process.env.OPENCLAUDE_INTERRUPT_TRACE
      } else {
        process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
      }
    }
  })

  test('parent abort settles the pending read before its idle deadline', async () => {
    const cancelReasons: unknown[] = []
    const response = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          cancelReasons.push(reason)
        },
      }),
    )
    const controller = new AbortController()
    const iterator = __codexStreamToAnthropicForTests(
      response,
      'gpt-test',
      controller.signal,
      { idleTimeoutMs: 1_000 },
    )[Symbol.asyncIterator]()
    try {
      expect((await bounded(iterator.next())).value?.type).toBe('message_start')

      const pending = iterator.next().then(
        value => ({ status: 'resolved' as const, value }),
        error => ({ status: 'rejected' as const, error }),
      )
      controller.abort('query-timeout')
      const result = await bounded(pending)

      expect(controller.signal.reason).toBe('query-timeout')
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') {
        expect((result.error as { name?: unknown }).name).toBe('AbortError')
      }
      expect(cancelReasons).toHaveLength(1)
    } finally {
      if (!controller.signal.aborted) controller.abort('test-cleanup')
      const returned = iterator.return?.(undefined)
      if (returned) await bounded(Promise.resolve(returned), 100).catch(() => {})
    }
  })

  test('normal terminal frames close the reader without an interruption trace', async () => {
    const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    __resetInterruptionTraceForTests()
    const cancelReasons: unknown[] = []
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array())
          controller.enqueue(encoder.encode([
            ': keepalive',
            '',
            'event: response.completed',
            'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
            '',
            '',
          ].join('\n')))
        },
        cancel(reason) {
          cancelReasons.push(reason)
        },
      }),
    )

    try {
      const events: AnthropicStreamEvent[] = []
      await bounded((async () => {
        for await (const event of codexStreamToAnthropic(response, 'gpt-test')) {
          events.push(event)
        }
      })())

      expect(events.at(-1)?.type).toBe('message_stop')
      const trace = __getInterruptionTraceSnapshotForTests()
      const firstRawBytes = trace.filter(
        entry => entry.event === 'codex_stream.first_raw_byte',
      )
      const terminal = trace.find(
        entry => entry.event === 'codex_stream.protocol_terminal',
      )
      expect(firstRawBytes).toHaveLength(1)
      expect(firstRawBytes[0]!.rawByteCount).toBeGreaterThan(0)
      expect(terminal).toBeDefined()
      expect(terminal!.controlFrameCount).toBe(1)
      expect(terminal!.ignoredFrameCount).toBe(0)
      expect(
        trace.some(entry => entry.event === 'codex_stream.cancelled'),
      ).toBe(false)
      expect(cancelReasons).toHaveLength(1)
    } finally {
      await __waitForInterruptionTraceFlushForTests()
      __resetInterruptionTraceForTests()
      if (originalTrace === undefined) {
        delete process.env.OPENCLAUDE_INTERRUPT_TRACE
      } else {
        process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
      }
    }
  })

  test('marks the converter complete before yielding message_stop', async () => {
    const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    __resetInterruptionTraceForTests()
    const cancelReasons: unknown[] = []
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            'event: response.completed',
            'data: {"type":"response.completed","response":{"status":"completed","output":[]}}',
            '',
            '',
          ].join('\n')))
        },
        cancel(reason) {
          cancelReasons.push(reason)
        },
      }),
    )
    const iterator = codexStreamToAnthropic(response, 'gpt-test')

    try {
      let next: IteratorResult<AnthropicStreamEvent>
      do {
        next = await bounded(iterator.next())
      } while (!next.done && next.value.type !== 'message_stop')
      expect(next.done).toBe(false)

      await bounded(iterator.return(undefined))

      const converterClosed = __getInterruptionTraceSnapshotForTests().find(
        entry => entry.event === 'codex_stream.converter_closed',
      )
      expect(converterClosed).toBeDefined()
      expect(converterClosed!.outcome).toBe('complete')
      expect(cancelReasons).toHaveLength(1)
    } finally {
      await bounded(iterator.return(undefined)).catch(() => {})
      await __waitForInterruptionTraceFlushForTests()
      __resetInterruptionTraceForTests()
      if (originalTrace === undefined) {
        delete process.env.OPENCLAUDE_INTERRUPT_TRACE
      } else {
        process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
      }
    }
  })

  test('keepalives and parsed-but-ignored frames cannot reset QueryGuard', async () => {
    const originalTrace = process.env.OPENCLAUDE_INTERRUPT_TRACE
    process.env.OPENCLAUDE_INTERRUPT_TRACE = '1'
    __resetInterruptionTraceForTests()
    const timed = makeTimedStream(
      index => {
        if (index % 3 === 0) return ': keepalive\n\n'
        if (index % 3 === 1) {
          return `event: response.created\ndata: {"type":"response.created","sequence_number":${index}}\n\n`
        }
        return `event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"r","sequence_number":${index}}\n\n`
      },
      25,
    )
    try {
      const outcome = await driveWithGuard(timed.response, {
        idleTimeoutMs: 250,
        hardMaxQueryMs: 1_500,
        readerIdleTimeoutMs: 500,
      })

      expect(outcome.timeout.reason satisfies QueryGuardTimeoutReason).toBe(
        'idle',
      )
      expect(outcome.signalReason).toBe('query-timeout')
      expect(outcome.result.status).toBe('rejected')
      expect(outcome.events.map(event => event.type)).toEqual([
        'message_start',
      ])
      const readerClosed = __getInterruptionTraceSnapshotForTests()
        .filter(entry => entry.event === 'codex_stream.cancelled')
        .at(-1)
      const rootAbort = __getInterruptionTraceSnapshotForTests().find(
        entry =>
          entry.event === 'abort.requested' && entry.source === 'query_guard',
      )
      const traceEvents = __getInterruptionTraceSnapshotForTests().map(
        entry => entry.event,
      )
      expect(timed.getEmissionCount()).toBeGreaterThan(3)
      expect(readerClosed?.rawByteCount).toBeGreaterThan(0)
      expect(readerClosed?.parsedFrameCount).toBeGreaterThan(0)
      expect(readerClosed?.controlFrameCount).toBeGreaterThan(0)
      expect(readerClosed?.ignoredFrameCount).toBe(0)
      expect(rootAbort).toBeDefined()
      expect(readerClosed).toBeDefined()
      expect(typeof rootAbort!.eventId).toBe('string')
      expect(typeof readerClosed!.causalEventId).toBe('string')
      expect(readerClosed!.causalEventId).toBe(rootAbort!.eventId)
      expect(traceEvents.indexOf('codex_stream.converter_closed')).toBeGreaterThan(
        traceEvents.indexOf('codex_stream.cancelled'),
      )
      expect(timed.cancelReasons).toHaveLength(1)
    } finally {
      timed.stop()
      await __waitForInterruptionTraceFlushForTests()
      __resetInterruptionTraceForTests()
      if (originalTrace === undefined) {
        delete process.env.OPENCLAUDE_INTERRUPT_TRACE
      } else {
        process.env.OPENCLAUDE_INTERRUPT_TRACE = originalTrace
      }
    }
  })

  test('valid deltas extend idle activity but cannot bypass the hard maximum', async () => {
    const timed = makeTimedStream(
      index =>
        `event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"x","sequence_number":${index}}\n\n`,
      25,
    )
    try {
      const outcome = await driveWithGuard(timed.response, {
        idleTimeoutMs: 250,
        hardMaxQueryMs: 600,
        readerIdleTimeoutMs: 500,
      })
      const countAtAbort = outcome.events.length
      await Bun.sleep(30)

      expect(outcome.timeout.reason satisfies QueryGuardTimeoutReason).toBe(
        'hard_max',
      )
      expect(outcome.signalReason).toBe('hard-max-query-timeout')
      expect(outcome.result.status).toBe('rejected')
      expect(countAtAbort).toBeGreaterThan(3)
      expect(outcome.events).toHaveLength(countAtAbort)
      expect(timed.cancelReasons).toHaveLength(1)
    } finally {
      timed.stop()
    }
  })

  test('repeated pending-read abort cycles cancel exactly once', async () => {
    for (let cycle = 0; cycle < 40; cycle++) {
      const cancelReasons: unknown[] = []
      const response = new Response(
        new ReadableStream<Uint8Array>({
          cancel(reason) {
            cancelReasons.push(reason)
          },
        }),
      )
      const controller = new AbortController()
      const iterator = __codexStreamToAnthropicForTests(
        response,
        'gpt-test',
        controller.signal,
        { idleTimeoutMs: 1_000 },
      )[Symbol.asyncIterator]()
      try {
        expect((await bounded(iterator.next())).value?.type).toBe(
          'message_start',
        )
        const pending = iterator.next().catch(error => error as unknown)
        controller.abort('user-cancel')
        await bounded(pending)
        expect(cancelReasons).toHaveLength(1)
      } finally {
        if (!controller.signal.aborted) controller.abort('test-cleanup')
        const returned = iterator.return?.(undefined)
        if (returned) {
          await bounded(Promise.resolve(returned), 100).catch(() => {})
        }
      }
    }
  })
})
