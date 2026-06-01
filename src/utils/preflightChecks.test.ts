import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, jest, mock, test } from 'bun:test'
import React from 'react'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

// MACRO is normally substituted at build time. The test runs without the
// bundler, so stub the build-time globals before importing the module under
// test (which transitively imports utils/http.ts -> MACRO.VERSION).
;(globalThis as unknown as { MACRO?: unknown }).MACRO ??= {
  VERSION: '0.0.0-test',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: 'test',
  ISSUES_EXPLAINER: '',
  PACKAGE_URL: '',
  NATIVE_PACKAGE_URL: undefined,
}

type TestStdin = PassThrough & {
  isTTY: boolean
  setRawMode: (mode: boolean) => void
  ref: () => void
  unref: () => void
}

const originalProcessExit = process.exit

function createTestStreams(): {
  stdout: PassThrough
  stdin: TestStdin
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as TestStdin

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120

  return {
    stdout,
    stdin,
  }
}

async function flushFakeTimerWork(iterations = 10): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await Promise.resolve()
    jest.advanceTimersByTime(0)
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

type TimerSpy = {
  mock: {
    calls: readonly unknown[][]
  }
}

function hasPreflightHoldTimer(
  setTimeoutSpy: TimerSpy,
  onSuccess: () => void,
  delay: number,
): boolean {
  return setTimeoutSpy.mock.calls.some(
    call => call[0] === onSuccess && call[1] === delay,
  )
}

async function waitForPreflightFailureEffect(
  setTimeoutSpy: TimerSpy,
  onSuccess: () => void,
  delay: number,
  exitCodes: readonly unknown[],
  getOnSuccessCallCount: () => number,
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await flushFakeTimerWork(1)
    if (
      exitCodes.length > 0 ||
      getOnSuccessCallCount() > 0 ||
      hasPreflightHoldTimer(setTimeoutSpy, onSuccess, delay)
    ) {
      return
    }
  }

  throw new Error('Timed out waiting for failed preflight hold timer')
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/preflightChecks.test.ts')
})

afterEach(() => {
  try {
    process.exit = originalProcessExit
    jest.restoreAllMocks()
    jest.useRealTimers()
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('checkEndpoints (preflight)', () => {
  test('passes a bounded timeout to axios so a hung probe cannot freeze onboarding (#1017)', async () => {
    const calls: Array<{ url: string; options: { timeout?: number } }> = []
    mock.module('axios', () => ({
      default: {
        get: async (
          url: string,
          options: { timeout?: number } = {},
        ): Promise<{ status: number }> => {
          calls.push({ url, options })
          return { status: 200 }
        },
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints, PREFLIGHT_REQUEST_TIMEOUT_MS } = await import(
      './preflightChecks.js'
    )

    const result = await checkEndpoints()

    expect(result.success).toBe(true)
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.options.timeout).toBe(PREFLIGHT_REQUEST_TIMEOUT_MS)
    }
    expect(PREFLIGHT_REQUEST_TIMEOUT_MS).toBeGreaterThan(0)
    expect(PREFLIGHT_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })

  test('returns a failure result (instead of throwing or hanging) when axios rejects with ECONNABORTED', async () => {
    mock.module('axios', () => ({
      default: {
        get: async (): Promise<never> => {
          const err = new Error('timeout of 5000ms exceeded') as Error & {
            code?: string
          }
          err.code = 'ECONNABORTED'
          throw err
        },
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints } = await import('./preflightChecks.js')

    const result = await checkEndpoints()

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error).toContain('Failed to connect to')
  })

  test('returns success when all probes return 200', async () => {
    mock.module('axios', () => ({
      default: {
        get: async (): Promise<{ status: number }> => ({ status: 200 }),
        isAxiosError: () => false,
      },
    }))

    const { checkEndpoints } = await import('./preflightChecks.js')

    const result = await checkEndpoints()
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('advances onboarding after a failed probe hold without exiting', async () => {
    const exitCodes: Array<string | number | null | undefined> = []
    let probeCalls = 0
    process.exit = ((code?: string | number | null | undefined) => {
      exitCodes.push(code)
      return undefined as never
    }) as typeof process.exit

    jest.useFakeTimers()
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    mock.module('../hooks/useTimeout.js', () => ({
      useTimeout: () => false,
    }))
    mock.module('axios', () => ({
      default: {
        get: async (): Promise<never> => {
          probeCalls++
          const err = new Error('timeout of 5000ms exceeded') as Error & {
            code?: string
          }
          err.code = 'ECONNABORTED'
          throw err
        },
        isAxiosError: () => false,
      },
    }))

    const { createRoot } = await import('../ink.js')
    const { PreflightStep, PREFLIGHT_ERROR_HOLD_MS } = await import(
      `./preflightChecks.js?failed-component-${Date.now()}`
    )
    const onSuccess = mock(() => {})
    const { stdout, stdin } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })

    try {
      root.render(React.createElement(PreflightStep, { onSuccess }))

      await waitForPreflightFailureEffect(
        setTimeoutSpy,
        onSuccess,
        PREFLIGHT_ERROR_HOLD_MS,
        exitCodes,
        () => onSuccess.mock.calls.length,
      )
      expect(probeCalls).toBeGreaterThan(0)
      expect(exitCodes).toEqual([])
      expect(onSuccess).not.toHaveBeenCalled()
      expect(
        hasPreflightHoldTimer(
          setTimeoutSpy,
          onSuccess,
          PREFLIGHT_ERROR_HOLD_MS,
        ),
      ).toBe(true)

      jest.advanceTimersByTime(PREFLIGHT_ERROR_HOLD_MS)
      await Promise.resolve()
      expect(exitCodes).toEqual([])
      expect(onSuccess).toHaveBeenCalledTimes(1)
    } finally {
      root.unmount()
      stdin.end()
      stdout.end()
    }
  })
})
