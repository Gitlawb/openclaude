import { describe, expect, mock, test } from 'bun:test'
import {
  createHeadlessHeartbeatStructuredEmitter,
  createRunHeadlessHeartbeat,
  runWithHeartbeatErrorCleanup,
} from './print.js'
import {
  HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
  shouldSelectHeadlessFinalMessage,
  type HeadlessHeartbeatEvent,
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

  return {
    now: () => nowMs,
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
    },
    tick: () => {
      for (const timer of timers) {
        if (timer.active) {
          timer.callback()
        }
      }
    },
  }
}

const heartbeatEvent: HeadlessHeartbeatEvent = {
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

describe('createHeadlessHeartbeatStructuredEmitter', () => {
  test('writes heartbeat events before the stream-json drain starts (avoids dropping startup signals)', async () => {
    const write = mock(async (_message: HeadlessHeartbeatEvent) => {})
    const enqueue = mock((_message: HeadlessHeartbeatEvent) => {})
    const emitter = createHeadlessHeartbeatStructuredEmitter(
      { write, outbound: { enqueue } },
      () => false,
    )

    await emitter(heartbeatEvent)

    expect(write).toHaveBeenCalledWith(heartbeatEvent)
    expect(enqueue).not.toHaveBeenCalled()
  })

  test('enqueues heartbeat events after the stream-json drain starts', async () => {
    const write = mock(async (_message: HeadlessHeartbeatEvent) => {})
    const enqueue = mock((_message: HeadlessHeartbeatEvent) => {})
    const emitter = createHeadlessHeartbeatStructuredEmitter(
      { write, outbound: { enqueue } },
      () => true,
    )

    await emitter(heartbeatEvent)

    expect(write).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(heartbeatEvent)
  })

  // Regression: the pre-drain branch must return the write promise so
  // callers can observe write failures and backpressure. The emitter
  // should reject when the underlying write rejects.
  test('propagates write rejection before drain starts', async () => {
    const writeError = new Error('write failed')
    const write = mock(async (_message: HeadlessHeartbeatEvent) => {
      throw writeError
    })
    const enqueue = mock((_message: HeadlessHeartbeatEvent) => {})
    const emitter = createHeadlessHeartbeatStructuredEmitter(
      { write, outbound: { enqueue } },
      () => false,
    )

    await expect(emitter(heartbeatEvent)).rejects.toThrow('write failed')
    expect(write).toHaveBeenCalledWith(heartbeatEvent)
    expect(enqueue).not.toHaveBeenCalled()
  })
})

describe('createRunHeadlessHeartbeat', () => {
  test('stops active heartbeats when guarded setup work throws', async () => {
    const stop = mock(() => {})
    const heartbeat = {
      start: () => {},
      stop,
      markActivity: () => {},
      setPhase: () => {},
    }

    await expect(
      runWithHeartbeatErrorCleanup(heartbeat, async () => {
        throw new Error('setup failed')
      }),
    ).rejects.toThrow('setup failed')
    expect(stop).toHaveBeenCalledTimes(1)
  })

  test('keeps stream-json heartbeats dormant until the print flow starts the drain', async () => {
    const clock = createFakeClock()
    const written: HeadlessHeartbeatEvent[] = []
    const enqueued: HeadlessHeartbeatEvent[] = []
    let streamJsonDrainStarted = false
    const emitStructured = createHeadlessHeartbeatStructuredEmitter(
      {
        write: async message => {
          written.push(message)
        },
        outbound: {
          enqueue: message => {
            enqueued.push(message)
          },
        },
      },
      () => streamJsonDrainStarted,
    )

    const heartbeat = createRunHeadlessHeartbeat({
      intervalMs: HEADLESS_HEARTBEAT_MIN_INTERVAL_MS,
      outputFormat: 'stream-json',
      verbose: true,
      getSessionId: () => 'session-id',
      getState: () => 'running',
      getPendingPermissionRequests: () => [],
      getBackgroundTaskCounts: () => ({}),
      emitStructured,
      now: clock.now,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      createUuid: () => `heartbeat-${written.length + enqueued.length + 1}`,
    })

    heartbeat?.start()
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    await clock.tick()

    expect(written).toHaveLength(1)
    expect(enqueued).toHaveLength(0)

    streamJsonDrainStarted = true
    heartbeat?.setPhase('loading_session')
    clock.advance(HEADLESS_HEARTBEAT_MIN_INTERVAL_MS)
    await clock.tick()

    expect(written).toHaveLength(1)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.phase).toBe('loading_session')

    const resultMessage = {
      type: 'result',
      subtype: 'success',
      result: 'done',
    }
    expect(
      [...written, ...enqueued, resultMessage].filter(
        shouldSelectHeadlessFinalMessage,
      ),
    ).toEqual([resultMessage])
  })
})
