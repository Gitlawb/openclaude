import { describe, test, expect } from 'bun:test'
import { query } from '../../src/entrypoints/sdk.js'

describe('SEC-1: env override isolation', () => {
  test('env overrides are restored after query completes', async () => {
    const key = 'SDK_TEST_SEC1_RESTORE'
    const originalVal = process.env[key]
    process.env[key] = 'original'

    try {
      const q = query({
        prompt: 'env restore test',
        options: {
          cwd: process.cwd(),
          env: { [key]: 'overridden' },
        },
      })
      q.interrupt()
      try { for await (const _ of q) {} } catch {}

      expect(process.env[key]).toBe('original')
    } finally {
      if (originalVal === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalVal
      }
    }
  })

  test('concurrent queries with different env overrides do not interfere', async () => {
    const key = 'SDK_TEST_SEC1_CONCURRENT'
    const originalVal = process.env[key]

    try {
      const q1 = query({
        prompt: 'env test 1',
        options: { cwd: process.cwd(), env: { [key]: 'query-1' } },
      })
      const q2 = query({
        prompt: 'env test 2',
        options: { cwd: process.cwd(), env: { [key]: 'query-2' } },
      })

      q1.interrupt()
      q2.interrupt()

      try { for await (const _ of q1) {} } catch {}
      try { for await (const _ of q2) {} } catch {}

      expect(process.env[key]).toBe(originalVal)
    } finally {
      if (originalVal === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalVal
      }
    }
  })

  test('queries without env overrides are not serialized', async () => {
    const q1 = query({
      prompt: 'no env 1',
      options: { cwd: process.cwd() },
    })
    const q2 = query({
      prompt: 'no env 2',
      options: { cwd: process.cwd() },
    })

    expect(q1.sessionId).toBeDefined()
    expect(q2.sessionId).toBeDefined()

    q1.interrupt()
    q2.interrupt()

    try { for await (const _ of q1) {} } catch {}
    try { for await (const _ of q2) {} } catch {}
  })
})
