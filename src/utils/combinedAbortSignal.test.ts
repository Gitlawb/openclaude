import { describe, expect, test } from 'bun:test'

import { createCombinedAbortSignal } from './combinedAbortSignal.js'

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

function waitForAbort(signal: AbortSignal, timeoutMs = 1000): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let failTimer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      clearTimeout(failTimer)
      resolve()
    }

    // Keep a ref'ed timer active while awaiting the helper's unref'ed timer.
    // Without this guard, Bun on Windows can leave the test waiting forever.
    failTimer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error(`AbortSignal did not abort within ${timeoutMs}ms`))
    }, timeoutMs)

    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

function instrumentAbortListeners(signal: AbortSignal): {
  added: unknown[]
  removed: unknown[]
  restore: () => void
} {
  const added: unknown[] = []
  const removed: unknown[] = []
  const originalAdd = signal.addEventListener.bind(signal)
  const originalRemove = signal.removeEventListener.bind(signal)

  signal.addEventListener = ((type, listener, options) => {
    if (type === 'abort') added.push(listener)
    return originalAdd(type, listener, options)
  }) as AbortSignal['addEventListener']

  signal.removeEventListener = ((type, listener, options) => {
    if (type === 'abort') removed.push(listener)
    return originalRemove(type, listener, options)
  }) as AbortSignal['removeEventListener']

  return {
    added,
    removed,
    restore: () => {
      signal.addEventListener = originalAdd as AbortSignal['addEventListener']
      signal.removeEventListener =
        originalRemove as AbortSignal['removeEventListener']
    },
  }
}

describe('createCombinedAbortSignal', () => {
  test('timeout aborts the combined signal after timeoutMs', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5,
    })

    try {
      await waitForAbort(signal)

      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBeInstanceOf(DOMException)
      expect((signal.reason as DOMException).name).toBe('TimeoutError')
    } finally {
      cleanup()
    }
  })

  test('cleanup clears the timeout before it fires', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5,
    })

    cleanup()
    await delay(20)

    expect(signal.aborted).toBe(false)
  })

  test('cleanup removes listeners from input signals', () => {
    const sourceA = new AbortController()
    const sourceB = new AbortController()
    const listenersA = instrumentAbortListeners(sourceA.signal)
    const listenersB = instrumentAbortListeners(sourceB.signal)

    try {
      const { signal, cleanup } = createCombinedAbortSignal(sourceA.signal, {
        signalB: sourceB.signal,
        timeoutMs: 100,
      })

      expect(listenersA.added).toHaveLength(1)
      expect(listenersB.added).toHaveLength(1)

      cleanup()

      expect(listenersA.removed).toEqual(listenersA.added)
      expect(listenersB.removed).toEqual(listenersB.added)

      sourceA.abort()
      sourceB.abort()
      expect(signal.aborted).toBe(false)
    } finally {
      listenersA.restore()
      listenersB.restore()
    }
  })

  test('aborting the input signal aborts the combined signal', () => {
    const source = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(source.signal, {
      timeoutMs: 100,
    })
    const reason = new Error('caller cancelled')

    try {
      source.abort(reason)

      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(reason)
    } finally {
      cleanup()
    }
  })

  test('aborting signalB aborts the combined signal', () => {
    const sourceA = new AbortController()
    const sourceB = new AbortController()
    const { signal, cleanup } = createCombinedAbortSignal(sourceA.signal, {
      signalB: sourceB.signal,
      timeoutMs: 100,
    })
    const reason = new Error('secondary cancelled')

    try {
      sourceB.abort(reason)

      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(reason)
    } finally {
      cleanup()
    }
  })

  test('already-aborted input signal returns an already-aborted combined signal', () => {
    const source = new AbortController()
    const reason = new Error('already cancelled')
    source.abort(reason)

    const { signal, cleanup } = createCombinedAbortSignal(source.signal, {
      timeoutMs: 100,
    })

    try {
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(reason)
    } finally {
      cleanup()
    }
  })

  test('cleanup is safe to call after completion', async () => {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5,
    })

    await waitForAbort(signal)

    expect(() => cleanup()).not.toThrow()
  })

  test('cleanup is safe to call more than once', () => {
    const { cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 100,
    })

    cleanup()

    expect(() => cleanup()).not.toThrow()
  })
})
