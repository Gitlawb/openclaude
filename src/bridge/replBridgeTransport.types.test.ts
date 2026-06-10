import { expect, test } from 'bun:test'
import { BridgeFatalError } from './bridgeApi.js'
import { DEFAULT_POLL_CONFIG } from './pollConfigDefaults.js'
import { _startWorkPollLoopForTesting } from './replBridge.js'
import type { ReplBridgeTransport } from './replBridgeTransport.js'
import type { BridgeApiClient } from './types.js'

type AssertPromiseVoid<T extends Promise<void>> = T

type _CloseReturnsPromise = AssertPromiseVoid<
  ReturnType<ReplBridgeTransport['close']>
>

test('work poll loop waits for heartbeat-fatal cleanup before fast-polling again', async () => {
  const abort = new AbortController()
  let pollCount = 0
  let resolveCleanup: (() => void) | undefined
  const cleanupStarted = deferred<void>()
  const secondPollStarted = deferred<void>()
  const cleanupReleased = new Promise<void>(resolve => {
    resolveCleanup = resolve
  })

  const api = {
    pollForWork: async () => {
      pollCount += 1
      if (pollCount === 2) {
        secondPollStarted.resolve()
        abort.abort()
      }
      return null
    },
    heartbeatWork: async () => {
      throw new BridgeFatalError('work item gone', 404)
    },
  } as unknown as BridgeApiClient

  let atCapacity = true
  const loop = _startWorkPollLoopForTesting({
    api,
    getCredentials: () => ({
      environmentId: 'env-1',
      environmentSecret: 'secret-1',
    }),
    signal: abort.signal,
    isAtCapacity: () => atCapacity,
    capacitySignal: createCapacitySignal,
    getHeartbeatInfo: () => ({
      environmentId: 'env-1',
      workId: 'work-1',
      sessionToken: 'token-1',
    }),
    getPollIntervalConfig: () => ({
      ...DEFAULT_POLL_CONFIG,
      poll_interval_ms_not_at_capacity: 1,
      poll_interval_ms_at_capacity: 10_000,
      non_exclusive_heartbeat_interval_ms: 1,
      reclaim_older_than_ms: 0,
    }),
    onWorkReceived: async () => {},
    onHeartbeatFatal: async () => {
      atCapacity = false
      cleanupStarted.resolve()
      await cleanupReleased
    },
  })

  await cleanupStarted.promise
  await Promise.resolve()
  await Promise.resolve()
  expect(pollCount).toBe(1)

  resolveCleanup?.()
  await secondPollStarted.promise
  await loop
  expect(pollCount).toBe(2)
})

function createCapacitySignal(): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    cleanup: () => {},
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}
