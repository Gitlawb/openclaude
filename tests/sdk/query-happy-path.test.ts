import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { MockQueryEngine } from './helpers/mock-engine.js'
import { query } from '../../src/entrypoints/sdk/index.js'

// ---------------------------------------------------------------------------
// No mock.module() — avoids module-cache leakage across test files.
// Instead, we replace the engine via setEngine() after query() returns.
// ---------------------------------------------------------------------------

// These tests iterate fully (no interrupt), so init() runs and may check for
// auth credentials. Provide a stub key so init() succeeds without network.
const AUTH_KEY = 'ANTHROPIC_API_KEY'
let savedApiKey: string | undefined

beforeAll(() => {
  savedApiKey = process.env[AUTH_KEY]
  if (!savedApiKey) {
    process.env[AUTH_KEY] = 'sk-test-happy-path-stub'
  }
})

afterAll(() => {
  if (savedApiKey === undefined) {
    delete process.env[AUTH_KEY]
  } else {
    process.env[AUTH_KEY] = savedApiKey
  }
})

/**
 * Create a Query with a MockQueryEngine wired in.
 * query() creates a real QueryEngine internally, which we immediately
 * replace with our mock via setEngine(). The real engine is discarded.
 */
function createMockedQuery(prompt: string): ReturnType<typeof query> {
  const mockEngine = new MockQueryEngine()
  const q = query({
    prompt,
    options: { cwd: process.cwd() },
  })
  // Replace the real engine with our mock before any iteration occurs.
  // The real QueryEngine was created synchronously in query() but
  // submitMessage() is only called when the async iterator is consumed.
  ;(q as any).setEngine(mockEngine)
  return q
}

describe('Query happy-path — full lifecycle', () => {
  test('single-turn query completes with assistant + result messages', async () => {
    const q = createMockedQuery('hello from test')

    const messages: unknown[] = []
    for await (const msg of q) {
      messages.push(msg)
    }

    // Should have at least an assistant message and a result message
    expect(messages.length).toBeGreaterThanOrEqual(2)

    const assistantMsgs = messages.filter(
      (m: any) => m?.type === 'assistant',
    )
    const resultMsgs = messages.filter(
      (m: any) => m?.type === 'result',
    )

    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1)
    expect(resultMsgs.length).toBeGreaterThanOrEqual(1)
  })

  test('result message has success subtype and session_id', async () => {
    const q = createMockedQuery('check result fields')

    const messages: unknown[] = []
    for await (const msg of q) {
      messages.push(msg)
    }

    const result = messages.find((m: any) => m?.type === 'result') as any
    expect(result).toBeDefined()
    expect(result.subtype).toBe('success')
    expect(result.session_id).toBeDefined()
    expect(typeof result.session_id).toBe('string')
  })

  test('query sessionId is accessible before iteration', () => {
    const q = createMockedQuery('sessionId check')

    expect(q.sessionId).toBeDefined()
    expect(typeof q.sessionId).toBe('string')
    // Don't need to iterate — just verify the accessor works
    q.interrupt()
  })

  test('collectMessages (no catch) completes without throwing', async () => {
    const q = createMockedQuery('no error collection')

    // This must NOT throw — if it does, the query failed
    const messages: unknown[] = []
    for await (const msg of q) {
      messages.push(msg)
    }

    expect(messages.length).toBeGreaterThan(0)
  })

  test('assistant message contains prompt echo', async () => {
    const prompt = 'unique-test-prompt-12345'
    const q = createMockedQuery(prompt)

    const messages: unknown[] = []
    for await (const msg of q) {
      messages.push(msg)
    }

    const assistant = messages.find((m: any) => m?.type === 'assistant') as any
    expect(assistant).toBeDefined()
    // Mock engine echoes the prompt in its response
    const textContent = assistant?.message?.content?.find(
      (c: any) => c?.type === 'text',
    )
    expect(textContent?.text).toContain(prompt)
  })
})
