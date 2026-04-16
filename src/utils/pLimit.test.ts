import { describe, test, expect } from 'bun:test'
import { runWithLimit, defaultConcurrency } from './pLimit.js'

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

describe('runWithLimit', () => {
  test('limit of 1 runs tasks sequentially', async () => {
    const order: number[] = []
    const tasks = [0, 1, 2].map(i => async () => {
      order.push(i)
      await delay(10)
      return i
    })

    const results = await runWithLimit(tasks, 1)
    expect(order).toEqual([0, 1, 2])
    expect(results.map(r => r.status === 'fulfilled' ? r.value : null)).toEqual([0, 1, 2])
  })

  test('never exceeds concurrency limit', async () => {
    let running = 0
    let maxRunning = 0

    const tasks = Array.from({ length: 8 }, (_, i) => async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await delay(20)
      running--
      return i
    })

    await runWithLimit(tasks, 3)
    expect(maxRunning).toBeLessThanOrEqual(3)
    expect(maxRunning).toBeGreaterThan(1) // actually uses parallelism
  })

  test('output preserves input order', async () => {
    // Tasks complete in reverse order due to staggered delays
    const tasks = [
      async () => { await delay(30); return 'a' },
      async () => { await delay(20); return 'b' },
      async () => { await delay(10); return 'c' },
    ]

    const results = await runWithLimit(tasks, 3)
    const values = results.map(r => r.status === 'fulfilled' ? r.value : null)
    expect(values).toEqual(['a', 'b', 'c'])
  })

  test('a rejected task does not abort others', async () => {
    const tasks = [
      async () => 'ok-0',
      async () => { throw new Error('boom') },
      async () => 'ok-2',
    ]

    const results = await runWithLimit(tasks, 2)
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'ok-0' })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'ok-2' })
  })

  test('empty task list returns empty array', async () => {
    const results = await runWithLimit([], 4)
    expect(results).toEqual([])
  })

  test('limit larger than task count works fine', async () => {
    const tasks = [async () => 1, async () => 2]
    const results = await runWithLimit(tasks, 100)
    expect(results).toHaveLength(2)
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)
  })
})

describe('defaultConcurrency', () => {
  test('returns 4', () => {
    expect(defaultConcurrency()).toBe(4)
  })
})
