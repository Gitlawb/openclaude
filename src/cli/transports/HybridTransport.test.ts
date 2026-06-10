import { afterEach, beforeEach, describe, expect, jest, mock, test } from 'bun:test'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

type AxiosPost = (
  url: string,
  data?: unknown,
  config?: unknown,
) => Promise<{ status: number }>

let postImpl: AxiosPost = async () => ({ status: 200 })

mock.module('axios', () => ({
  default: {
    post: (...args: Parameters<AxiosPost>) => postImpl(...args),
  },
}))

describe('HybridTransport close', () => {
  beforeEach(() => {
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'test-token'
  })

  afterEach(() => {
    delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
    postImpl = async () => ({ status: 200 })
    jest.restoreAllMocks()
  })

  test('drains buffered stream events before closing the uploader', async () => {
    const posts: Array<{ url: string; data: unknown }> = []
    postImpl = async (url, data) => {
      posts.push({ url, data })
      return { status: 200 }
    }
    const transport = await createTransport()
    const streamEvent: StdoutMessage = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    }

    await transport.write(streamEvent)
    await transport.close()

    expect(posts).toEqual([
      {
        url: 'https://example.com/v2/session_ingress/session/session-1/events',
        data: { events: [streamEvent] },
      },
    ])
  })

  test('uses a close grace period when the final upload stalls', async () => {
    postImpl = async () => new Promise(() => {})
    const transport = await createTransport({ closeGraceMs: 1 })

    const writePromise = transport.write({
      type: 'result',
      subtype: 'success',
      duration_ms: 0,
      duration_api_ms: 0,
      is_error: false,
      result: 'ok',
      session_id: 'session-1',
    })
    const closePromise = transport.close().then(() => 'closed' as const)

    expect(await settledValue(closePromise)).toBe('pending')

    await expect(
      Promise.race([closePromise, delay(25).then(() => 'pending' as const)]),
    ).resolves.toBe('closed')
    await expect(writePromise).resolves.toBeUndefined()
  })

  test('clears the close grace timer when the final upload finishes first', async () => {
    const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout')
    const transport = await createTransport({ closeGraceMs: 50 })

    await transport.write({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      },
    })
    await transport.close()

    const closeGraceCallIndex = setTimeoutSpy.mock.calls.findIndex(
      call => call[1] === 50,
    )
    expect(closeGraceCallIndex).toBeGreaterThanOrEqual(0)
    const closeGraceTimer =
      setTimeoutSpy.mock.results[closeGraceCallIndex]?.value
    expect(
      clearTimeoutSpy.mock.calls.some(call => call[0] === closeGraceTimer),
    ).toBe(true)
  })
})

async function createTransport(options?: { closeGraceMs?: number }) {
  const { HybridTransport } = await import(
    `./HybridTransport.js?test=${Date.now()}-${Math.random()}`
  )
  return new HybridTransport(
    new URL('wss://example.com/v2/session_ingress/ws/session-1'),
    {},
    'session-1',
    undefined,
    options,
  )
}

async function settledValue<T>(promise: Promise<T>): Promise<T | 'pending'> {
  const pending = Symbol('pending')
  const result = await Promise.race([promise, Promise.resolve(pending)])
  return result === pending ? 'pending' : result
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
