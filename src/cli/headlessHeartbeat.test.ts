import { describe, expect, mock, test } from 'bun:test'
import {
  createHeadlessHeartbeat,
  HEADLESS_HEARTBEAT_MAX_INTERVAL_MS,
  HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
  isHeadlessHeartbeatMessage,
  parseHeadlessHeartbeatDuration,
  shouldSelectHeadlessFinalMessage,
  validateHeadlessHeartbeatPrintMode,
} from './headlessHeartbeat.js'

type FakeTimer = {
  active: boolean
  callback: () => void
  intervalMs: number
  unref: ReturnType<typeof mock>
}

function createFakeClock(startMs = 0) {
  let nowMs = startMs
  const timers: FakeTimer[] = []
  const cleared: FakeTimer[] = []

  return {
    now: () => nowMs,
    setNow: (nextMs: number) => {
      nowMs = nextMs
    },
    advance: (deltaMs: number) => {
      nowMs += deltaMs
    },
    setInterval: (callback: () => void, intervalMs: number) => {
      const timer: FakeTimer = {
        active: true,
        callback,
        intervalMs,
        unref: mock(() => {}),
      }
      timers.push(timer)
      return timer
    },
    clearInterval: (timer: unknown) => {
      const fakeTimer = timer as FakeTimer
      fakeTimer.active = false
      cleared.push(fakeTimer)
    },
    tick: () => {
      for (const timer of timers) {
        if (timer.active) {
          timer.callback()
        }
      }
    },
    timers,
    cleared,
  }
}

describe('parseHeadlessHeartbeatDuration', () => {
  test('accepts explicit millisecond, second, and minute durations', () => {
    expect(parseHeadlessHeartbeatDuration('5000ms')).toBe(5_000)
    expect(parseHeadlessHeartbeatDuration('5s')).toBe(5_000)
    expect(parseHeadlessHeartbeatDuration('30s')).toBe(30_000)
    expect(parseHeadlessHeartbeatDuration('2m')).toBe(120_000)
  })

  test('rejects invalid, zero, negative, sub-minimum, and oversized durations', () => {
    for (const value of ['abc', '', '5000', '1h', '-1s']) {
      expect(() => parseHeadlessHeartbeatDuration(value)).toThrow(
        '--heartbeat must be a duration like 30s, 2m, or 5000ms.',
      )
    }

    for (const value of ['0', '0s', '1s', '4999ms']) {
      expect(() => parseHeadlessHeartbeatDuration(value)).toThrow(
        '--heartbeat must be at least 5s.',
      )
    }

    expect(() =>
      parseHeadlessHeartbeatDuration(`${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS + 1}ms`),
    ).toThrow(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
    expect(() => parseHeadlessHeartbeatDuration('9999999999999999s')).toThrow(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
  })
})

describe('createHeadlessHeartbeat', () => {
  test('emits a quiet-based stderr heartbeat and uses unref', () => {
    const clock = createFakeClock(1_000)
    const stderrLines: string[] = []

    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'text',
      getSessionId: () => 'session-1',
      getState: () => 'running',
      initialPhase: 'in_turn',
      emitStderr: line => stderrLines.push(line),
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    expect(clock.timers).toHaveLength(1)
    expect(clock.timers[0]!.intervalMs).toBe(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    expect(clock.timers[0]!.unref).toHaveBeenCalledTimes(1)

    clock.advance(4_999)
    clock.tick()
    expect(stderrLines).toEqual([])

    clock.advance(1)
    clock.tick()
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('openclaude: heartbeat')
    expect(stderrLines[0]).toContain('elapsed=5s')
    expect(stderrLines[0]).toContain('quiet=5s')
    expect(stderrLines[0]).toContain('state=running')
    expect(stderrLines[0]).toContain('phase=in_turn')
    expect(stderrLines[0]).toContain('session=session-1')
  })

  test('suppresses heartbeats while normal activity is flowing', () => {
    const clock = createFakeClock(0)
    const stderrLines: string[] = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'json',
      emitStderr: line => stderrLines.push(line),
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    clock.advance(4_000)
    heartbeat.markActivity()
    expect(clock.cleared).toHaveLength(1)
    expect(clock.timers).toHaveLength(2)
    expect(clock.timers[0]!.active).toBe(false)
    expect(clock.timers[1]!.active).toBe(true)

    clock.advance(1_000)
    clock.tick()
    expect(stderrLines).toEqual([])

    clock.advance(3_999)
    clock.tick()
    expect(stderrLines).toEqual([])

    clock.advance(1)
    clock.tick()
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('quiet=5s')
  })

  test('emits structured stream-json heartbeat events with safe metadata only', () => {
    const clock = createFakeClock(10_000)
    const structured: Array<Record<string, unknown>> = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      getSessionId: () => 'session-2',
      getState: () => 'requires_action',
      initialPhase: 'waiting_for_permission',
      getPendingPermissionRequests: () => ['request-1'],
      getBackgroundTaskCounts: () => ({
        local_agent: 2.9,
        local_workflow: 1,
        fractional_agent: 0.5,
      }),
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      createUuid: () => 'uuid-1',
    })

    heartbeat.start()
    clock.advance(5_000)
    clock.tick()

    expect(structured).toEqual([
      {
        type: 'system',
        subtype: 'heartbeat',
        timestamp: '1970-01-01T00:00:15.000Z',
        elapsed_ms: 5_000,
        since_last_activity_ms: 5_000,
        state: 'requires_action',
        phase: 'waiting_for_permission',
        heartbeat_index: 1,
        pending_permission_requests: 1,
        background_tasks: { local_agent: 2, local_workflow: 1 },
        uuid: 'uuid-1',
        session_id: 'session-2',
      },
    ])
    expect(JSON.stringify(structured[0])).not.toContain('prompt')
    expect(JSON.stringify(structured[0])).not.toContain('cwd')
  })

  test('clamps emitted durations when the system clock moves backward', () => {
    const clock = createFakeClock(10_000)
    const structured: Array<Record<string, unknown>> = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    clock.setNow(0)
    heartbeat.markActivity()
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    clock.tick()

    expect(structured).toHaveLength(1)
    expect(structured[0]).toMatchObject({
      elapsed_ms: 0,
      since_last_activity_ms: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
    })
  })

  test('emits after a backward clock jump without waiting for wall time to catch up', () => {
    const clock = createFakeClock(10_000)
    const structured: Array<Record<string, unknown>> = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    clock.setNow(0)
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    clock.tick()

    expect(structured).toHaveLength(1)
    expect(structured[0]).toMatchObject({
      elapsed_ms: 0,
      since_last_activity_ms: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
    })
  })

  test('falls back to safe metadata defaults when heartbeat getters throw', () => {
    const clock = createFakeClock(0)
    const structured: Array<Record<string, unknown>> = []
    const throwMetadataError = () => {
      throw new Error('metadata unavailable')
    }
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      getSessionId: throwMetadataError,
      getState: throwMetadataError,
      getPendingPermissionRequests: throwMetadataError,
      getBackgroundTaskCounts: throwMetadataError,
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      createUuid: throwMetadataError,
    })

    heartbeat.start()
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)

    expect(() => clock.tick()).not.toThrow()
    expect(structured).toHaveLength(1)
    expect(structured[0]).toMatchObject({
      state: 'running',
      pending_permission_requests: 0,
      background_tasks: {},
      uuid: '00000000-0000-4000-8000-000000000000',
      session_id: '',
    })
  })

  test('updates phase and heartbeat index across emissions', () => {
    const clock = createFakeClock(0)
    const structured: Array<Record<string, unknown>> = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      initialPhase: 'startup',
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      createUuid: () => `uuid-${structured.length + 1}`,
    })

    heartbeat.start()
    clock.advance(5_000)
    clock.tick()
    heartbeat.setPhase('flushing')
    clock.advance(5_000)
    clock.tick()

    expect(structured.map(event => event.phase)).toEqual(['startup', 'flushing'])
    expect(structured.map(event => event.heartbeat_index)).toEqual([1, 2])
  })

  test('stop is idempotent and clears the active timer', () => {
    const clock = createFakeClock()
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'text',
      emitStderr: () => {},
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    heartbeat.stop()
    heartbeat.stop()

    expect(clock.cleared).toHaveLength(1)
    expect(clock.timers[0]!.active).toBe(false)
  })

  test('treats a zero timer handle as active', () => {
    const setIntervalMock = mock(() => 0)
    const clearIntervalMock = mock(() => {})
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'text',
      now: () => 0,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
    })

    heartbeat.start()
    heartbeat.start()
    expect(setIntervalMock).toHaveBeenCalledTimes(1)

    heartbeat.markActivity()
    expect(clearIntervalMock).toHaveBeenCalledWith(0)
    expect(setIntervalMock).toHaveBeenCalledTimes(2)

    heartbeat.stop()
    heartbeat.stop()
    expect(clearIntervalMock).toHaveBeenCalledTimes(2)
  })

  test('restart resets the heartbeat index and phase for the next run', () => {
    const clock = createFakeClock()
    const structured: Array<Record<string, unknown>> = []
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      initialPhase: 'startup',
      emitStructured: event => {
        structured.push(event)
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    clock.tick()
    heartbeat.setPhase('flushing')
    heartbeat.stop()
    heartbeat.start()
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    clock.tick()

    expect(structured.map(event => event.heartbeat_index)).toEqual([1, 1])
    expect(structured.map(event => event.phase)).toEqual(['startup', 'startup'])
  })

  test('ignores heartbeat write failures from closed outputs', () => {
    const clock = createFakeClock()
    const heartbeat = createHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'text',
      emitStderr: () => {
        throw Object.assign(new Error('stderr closed'), { code: 'EPIPE' })
      },
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
    })

    heartbeat.start()
    clock.advance(5_000)

    expect(() => clock.tick()).not.toThrow()
  })

  test('rejects oversized intervals before scheduling', () => {
    expect(() =>
      createHeadlessHeartbeat({
        intervalMs: HEADLESS_HEARTBEAT_MAX_INTERVAL_MS + 1,
      }),
    ).toThrow(
      `--heartbeat must be no more than ${HEADLESS_HEARTBEAT_MAX_INTERVAL_MS}ms.`,
    )
  })

  test('rejects stream-json heartbeat output without a structured sink', () => {
    expect(() =>
      createHeadlessHeartbeat({
        intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
        outputFormat: 'stream-json',
      }),
    ).toThrow('stream-json heartbeat output requires a structured sink.')
  })

  test('text and json heartbeats use stderr, not structured stdout', () => {
    for (const outputFormat of ['text', 'json']) {
      const clock = createFakeClock()
      const stderrLines: string[] = []
      const structured: unknown[] = []
      const heartbeat = createHeadlessHeartbeat({
        intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
        outputFormat,
        emitStderr: line => stderrLines.push(line),
        emitStructured: event => {
          structured.push(event)
        },
        now: clock.now,
        setInterval: clock.setInterval,
        clearInterval: clock.clearInterval,
      })

      heartbeat.start()
      clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
      clock.tick()

      expect(stderrLines).toHaveLength(1)
      expect(structured).toEqual([])
    }
  })
})

test('validateHeadlessHeartbeatPrintMode rejects heartbeat without --print', () => {
  expect(() => validateHeadlessHeartbeatPrintMode(undefined, false)).not.toThrow()
  expect(() => validateHeadlessHeartbeatPrintMode(5_000, true)).not.toThrow()
  expect(() => validateHeadlessHeartbeatPrintMode(5_000, false)).toThrow(
    '--heartbeat can only be used with --print.',
  )
})

test('heartbeat events are excluded from final-result and verbose JSON selection', () => {
  const heartbeatMessage = {
    type: 'system',
    subtype: 'heartbeat',
    timestamp: '2026-06-25T12:00:30.000Z',
    elapsed_ms: 30_000,
    since_last_activity_ms: 30_000,
    state: 'running',
    phase: 'in_turn',
    heartbeat_index: 1,
    pending_permission_requests: 0,
    background_tasks: {},
    uuid: 'heartbeat-uuid',
    session_id: 'session-id',
  }
  const resultMessage = {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'done',
    session_id: 'session-id',
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    uuid: 'result-uuid',
  }
  const filesPersistedMessage = {
    type: 'system',
    subtype: 'files_persisted',
    files: [],
    failed: [],
    processed_at: '2026-06-25T12:00:31.000Z',
    uuid: 'files-uuid',
    session_id: 'session-id',
  }
  const postTurnSummaryMessage = {
    type: 'system',
    subtype: 'post_turn_summary',
  }

  expect(shouldSelectHeadlessFinalMessage(heartbeatMessage)).toBe(false)
  expect(shouldSelectHeadlessFinalMessage(postTurnSummaryMessage)).toBe(false)
  expect(shouldSelectHeadlessFinalMessage(filesPersistedMessage)).toBe(false)
  expect(isHeadlessHeartbeatMessage(heartbeatMessage)).toBe(true)
  expect(isHeadlessHeartbeatMessage('partial output')).toBe(false)
  expect(shouldSelectHeadlessFinalMessage(resultMessage)).toBe(true)
  expect(shouldSelectHeadlessFinalMessage(null)).toBe(false)
  expect(shouldSelectHeadlessFinalMessage('partial output')).toBe(false)
  expect(shouldSelectHeadlessFinalMessage({})).toBe(false)
  expect(
    [
      heartbeatMessage,
      postTurnSummaryMessage,
      resultMessage,
      filesPersistedMessage,
    ].filter(shouldSelectHeadlessFinalMessage),
  ).toEqual([resultMessage])
})
