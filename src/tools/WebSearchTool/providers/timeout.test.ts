import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_WEB_SEARCH_TIMEOUT_SECONDS,
  getWebSearchTimeoutMs,
  withWebSearchTimeout,
} from './timeout.js'

describe('getWebSearchTimeoutMs', () => {
  test('returns the 15 second default', () => {
    expect(getWebSearchTimeoutMs({} as NodeJS.ProcessEnv)).toBe(
      DEFAULT_WEB_SEARCH_TIMEOUT_SECONDS * 1000,
    )
  })

  test('uses WEB_SEARCH_TIMEOUT_SEC when it is a positive finite integer', () => {
    expect(
      getWebSearchTimeoutMs({
        WEB_SEARCH_TIMEOUT_SEC: '2',
      } as NodeJS.ProcessEnv),
    ).toBe(2000)
  })

  test('falls back to the default for invalid or absurd values', () => {
    for (const value of ['', '0', '-1', '0.5', '1.5', '2.0', 'nope', 'Infinity', '999999']) {
      expect(
        getWebSearchTimeoutMs({
          WEB_SEARCH_TIMEOUT_SEC: value,
        } as NodeJS.ProcessEnv),
      ).toBe(DEFAULT_WEB_SEARCH_TIMEOUT_SECONDS * 1000)
    }
  })

  test('accepts the configured maximum timeout and rejects values above it', () => {
    expect(
      getWebSearchTimeoutMs({
        WEB_SEARCH_TIMEOUT_SEC: '300',
      } as NodeJS.ProcessEnv),
    ).toBe(300_000)

    expect(
      getWebSearchTimeoutMs({
        WEB_SEARCH_TIMEOUT_SEC: '301',
      } as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_WEB_SEARCH_TIMEOUT_SECONDS * 1000)
  })
})

describe('withWebSearchTimeout', () => {
  test('rejects a never-resolving operation on timeout', async () => {
    await expect(
      withWebSearchTimeout(
        () => new Promise(() => undefined),
        undefined,
        { providerName: 'TestSearch', timeoutMs: 5 },
      ),
    ).rejects.toThrow(/TestSearch search timed out/)
  })

  test('timeout errors carry a stable marker', async () => {
    await expect(
      withWebSearchTimeout(
        () => new Promise(() => undefined),
        undefined,
        { providerName: 'TestSearch', timeoutMs: 5 },
      ),
    ).rejects.toMatchObject({
      name: 'WebSearchTimeoutError',
      code: 'WEB_SEARCH_TIMEOUT',
      timeoutMs: 5,
    })
  })

  test('keeps caller aborts as AbortError and does not start work', async () => {
    const controller = new AbortController()
    controller.abort()

    let started = false
    await expect(
      withWebSearchTimeout(
        async () => {
          started = true
          return 'unexpected'
        },
        controller.signal,
        { providerName: 'TestSearch', timeoutMs: 5 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(started).toBe(false)
  })

  test('races non-signal-aware DuckDuckGo-style work at the timeout boundary', async () => {
    let observedSignal: AbortSignal | undefined

    await expect(
      withWebSearchTimeout(
        signal => {
          observedSignal = signal
          return new Promise(() => undefined)
        },
        undefined,
        { providerName: 'DuckDuckGo', timeoutMs: 5 },
      ),
    ).rejects.toThrow(/DuckDuckGo search timed out/)

    expect(observedSignal?.aborted).toBe(true)
  })

  test('removes caller abort listeners after successful operations', async () => {
    const controller = new AbortController()
    const addEventListener = controller.signal.addEventListener.bind(controller.signal)
    const removeEventListener = controller.signal.removeEventListener.bind(controller.signal)
    let abortListenersAdded = 0
    let abortListenersRemoved = 0

    controller.signal.addEventListener = ((type, listener, options) => {
      if (type === 'abort') abortListenersAdded++
      return addEventListener(type, listener, options)
    }) as typeof controller.signal.addEventListener

    controller.signal.removeEventListener = ((type, listener, options) => {
      if (type === 'abort') abortListenersRemoved++
      return removeEventListener(type, listener, options)
    }) as typeof controller.signal.removeEventListener

    try {
      await expect(
        withWebSearchTimeout(
          async () => 'ok',
          controller.signal,
          { providerName: 'TestSearch', timeoutMs: 100 },
        ),
      ).resolves.toBe('ok')
    } finally {
      controller.signal.addEventListener = addEventListener
      controller.signal.removeEventListener = removeEventListener
    }

    expect(abortListenersAdded).toBeGreaterThan(0)
    expect(abortListenersRemoved).toBe(abortListenersAdded)
  })

  test('removes caller abort listeners after timed-out operations', async () => {
    const controller = new AbortController()
    const addEventListener = controller.signal.addEventListener.bind(controller.signal)
    const removeEventListener = controller.signal.removeEventListener.bind(controller.signal)
    let abortListenersAdded = 0
    let abortListenersRemoved = 0

    controller.signal.addEventListener = ((type, listener, options) => {
      if (type === 'abort') abortListenersAdded++
      return addEventListener(type, listener, options)
    }) as typeof controller.signal.addEventListener

    controller.signal.removeEventListener = ((type, listener, options) => {
      if (type === 'abort') abortListenersRemoved++
      return removeEventListener(type, listener, options)
    }) as typeof controller.signal.removeEventListener

    try {
      await expect(
        withWebSearchTimeout(
          () => new Promise(() => undefined),
          controller.signal,
          { providerName: 'TestSearch', timeoutMs: 5 },
        ),
      ).rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT' })
    } finally {
      controller.signal.addEventListener = addEventListener
      controller.signal.removeEventListener = removeEventListener
    }

    expect(abortListenersAdded).toBeGreaterThan(0)
    expect(abortListenersRemoved).toBe(abortListenersAdded)
  })
})
