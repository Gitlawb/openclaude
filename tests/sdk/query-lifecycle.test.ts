import { describe, test, expect } from 'bun:test'
import { query } from '../../src/entrypoints/sdk.js'

describe('Query.sessionId accessor (API-1)', () => {
  test('query() returns a Query with sessionId for fresh query', () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd() },
    })
    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    expect(q.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    q.interrupt()
  })

  test('query() with sessionId option returns that sessionId', () => {
    const sid = '12345678-1234-1234-1234-123456789012'
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd(), sessionId: sid },
    })
    expect(q.sessionId).toBe(sid)
    q.interrupt()
  })

  test('query() with continue:true still has a sessionId', () => {
    const q = query({
      prompt: 'test',
      options: { cwd: process.cwd(), continue: true },
    })
    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    q.interrupt()
  })

  test('two queries have different sessionIds', () => {
    const q1 = query({ prompt: 'a', options: { cwd: process.cwd() } })
    const q2 = query({ prompt: 'b', options: { cwd: process.cwd() } })
    expect(q1.sessionId).not.toBe(q2.sessionId)
    q1.interrupt()
    q2.interrupt()
  })
})
