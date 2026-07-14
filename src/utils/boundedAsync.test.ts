import { describe, expect, test } from 'bun:test'
import { mapWithConcurrency, raceAbort } from './boundedAsync.js'

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('mapWithConcurrency', () => {
  test('preserves input order while bounding active mappers', async () => {
    let active = 0
    let maxActive = 0

    const result = await mapWithConcurrency(
      [3, 1, 2, 0],
      2,
      async value => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, value * 5))
        active--
        return value * 10
      },
    )

    expect(result).toEqual([30, 10, 20, 0])
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  test('does not schedule every item at once', async () => {
    const gate = deferred()
    let started = 0

    const promise = mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async value => {
        started++
        await gate.promise
        return value
      },
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toBe(8)
    gate.resolve()
    await expect(promise).resolves.toHaveLength(50)
  })

  test('rejects invalid concurrency', async () => {
    await expect(
      mapWithConcurrency([1], 0, async value => value),
    ).rejects.toThrow('concurrency must be >= 1')
  })

  test('rejects before scheduling work when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let started = false

    await expect(
      mapWithConcurrency(
        [1],
        1,
        async value => {
          started = true
          return value
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBe(false)
  })

  test('normalizes non-Error abort reasons when already aborted', async () => {
    const controller = new AbortController()
    controller.abort('cancelled')
    let started = false

    await expect(
      mapWithConcurrency(
        [1],
        1,
        async value => {
          started = true
          return value
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBe(false)
  })

  test('rejects and stops queued work when signal aborts mid-flight', async () => {
    const controller = new AbortController()
    const gate = deferred()
    const started: number[] = []

    const promise = mapWithConcurrency(
      [0, 1, 2, 3],
      2,
      async value => {
        started.push(value)
        await gate.promise
        return value
      },
      { signal: controller.signal },
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1])

    controller.abort('cancelled')
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    gate.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1])
  })

  test('stops scheduling queued items after the first mapper rejection', async () => {
    const failFirst = deferred()
    const holdSecond = deferred()
    const error = new Error('mapper failed')
    const started: number[] = []

    const promise = mapWithConcurrency([0, 1, 2, 3], 2, async value => {
      started.push(value)
      if (value === 0) {
        await failFirst.promise
        throw error
      }
      if (value === 1) {
        await holdSecond.promise
      }
      return value
    })

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1])

    failFirst.resolve()
    await expect(promise).rejects.toBe(error)

    holdSecond.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual([0, 1])
  })
})

describe('raceAbort', () => {
  test('propagates non-abort inner rejection', async () => {
    const controller = new AbortController()
    const error = new Error('inner failed')

    try {
      await raceAbort(Promise.reject(error), controller.signal)
      throw new Error('expected raceAbort to reject')
    } catch (caught) {
      expect(caught).toBe(error)
    }
  })

  test('does not leak unhandled rejection when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      const lateFailure = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('late failure')), 0)
      })

      await expect(
        raceAbort(lateFailure, controller.signal, 'already aborted'),
      ).rejects.toMatchObject({ name: 'AbortError' })
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('rejects when signal aborts before inner promise settles', async () => {
    const controller = new AbortController()
    const never = new Promise<string>(() => {})
    const raced = raceAbort(never, controller.signal, 'attachment timeout')

    controller.abort()

    await expect(raced).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('returns promise value when it settles before abort', async () => {
    const controller = new AbortController()
    await expect(
      raceAbort(Promise.resolve('done'), controller.signal),
    ).resolves.toBe('done')
  })
})
