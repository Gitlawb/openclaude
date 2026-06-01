import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

import { _resetKeepAliveForTesting } from '../../utils/proxy.js'
import {
  fetchWithProxyRetry,
  isRetryableFetchError,
  _resetUndiciFetchForTesting,
} from './fetchWithProxyRetry.js'

type FetchType = typeof globalThis.fetch

const originalFetch = globalThis.fetch
const originalEnv = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
}

function restoreEnv(key: 'HTTP_PROXY' | 'HTTPS_PROXY', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

/**
 * Create a mock fetch that captures the URL and init args.
 * Works whether the caller uses globalThis.fetch or undici.fetch,
 * since under Bun + dispatcher, fetchWithProxyRetry routes through undici.
 */
function createCapturingFetch() {
  let capturedUrl: string | undefined
  let capturedInit: RequestInit | undefined

  const mockFn = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    capturedInit = init
    return new Response('ok')
  }) as FetchType

  // Reset the cached undici fetch reference so mock.module takes effect.
  _resetUndiciFetchForTesting()

  // Mock both globalThis.fetch and undici.fetch so the test captures
  // regardless of which path fetchWithProxyRetry takes.
  globalThis.fetch = mockFn

  // Mock undici module so that when fetchWithProxyRetry requires it under Bun,
  // it gets our capturing mock instead of the real undici fetch.
  mock.module('undici', () => ({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ...require('undici'),
    fetch: mockFn,
  }))

  return {
    get url() { return capturedUrl },
    get init() { return capturedInit },
  }
}

beforeEach(async () => {
  await acquireSharedMutationLock('fetchWithProxyRetry.test.ts')
  process.env.HTTP_PROXY = 'http://127.0.0.1:15236'
  delete process.env.HTTPS_PROXY
  _resetKeepAliveForTesting()
})

afterEach(() => {
  try {
    mock.restore()
    globalThis.fetch = originalFetch
    restoreEnv('HTTP_PROXY', originalEnv.HTTP_PROXY)
    restoreEnv('HTTPS_PROXY', originalEnv.HTTPS_PROXY)
    _resetKeepAliveForTesting()
  } finally {
    releaseSharedMutationLock()
  }
})

test('isRetryableFetchError matches Bun socket-closed failures', () => {
  expect(
    isRetryableFetchError(
      new Error(
        'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
      ),
    ),
  ).toBe(true)
})

test('fetchWithProxyRetry retries once with keepalive disabled after socket closure', async () => {
  const calls: Array<RequestInit | undefined> = []

  globalThis.fetch = (async (_input, init) => {
    calls.push(init)
    if (calls.length === 1) {
      throw new Error(
        'The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()',
      )
    }
    return new Response('ok')
  }) as FetchType

  const response = await fetchWithProxyRetry('https://example.com/search', {
    method: 'POST',
  })

  expect(await response.text()).toBe('ok')
  expect(calls).toHaveLength(2)
  expect((calls[0] as RequestInit & { proxy?: string }).proxy).toBe(
    'http://127.0.0.1:15236',
  )
  expect((calls[0] as RequestInit).keepalive).toBeUndefined()
  expect((calls[1] as RequestInit).keepalive).toBe(false)
})

test('fetchWithProxyRetry does not retry non-network errors', async () => {
  let attempts = 0

  globalThis.fetch = (async () => {
    attempts += 1
    throw new Error('400 bad request')
  }) as FetchType

  await expect(fetchWithProxyRetry('https://example.com')).rejects.toThrow(
    '400 bad request',
  )
  expect(attempts).toBe(1)
})

test('fetchWithProxyRetry retries and disables keepalive after receiving a 504 response', async () => {
  const calls: Array<RequestInit | undefined> = []
  
  globalThis.fetch = (async (_input, init) => {
    calls.push(init)
    if (calls.length === 1) {
      return new Response('Gateway Timeout', { status: 504 })
    }
    return new Response('ok')
  }) as FetchType

  const response = await fetchWithProxyRetry('https://example.com/search')
  expect(response.status).toBe(200)
  expect(calls).toHaveLength(2)
  expect((calls[0] as RequestInit).keepalive).toBeUndefined()
  expect((calls[1] as RequestInit).keepalive).toBe(false)
})

test('fetchWithProxyRetry applies scoped dispatcher when target URL is in NO_PROXY', async () => {
  // Regression for: hasActiveProxy = Boolean(getProxyUrl()) was too broad.
  // With HTTPS_PROXY set but NO_PROXY=opengateway.gitlawb.com, the request
  // goes direct and MUST still receive the IPv4 scoped dispatcher.
  process.env.HTTPS_PROXY = 'http://127.0.0.1:15236'
  process.env.NO_PROXY = 'opengateway.gitlawb.com'

  const captured = createCapturingFetch()
  const fakeDispatcher = { fake: true } as unknown as import('undici').Dispatcher

  await fetchWithProxyRetry('https://opengateway.gitlawb.com/v1/chat', undefined, {
    dispatcher: fakeDispatcher,
  })

  type CapturedInit = RequestInit & { dispatcher?: unknown; proxy?: string }
  // The scoped dispatcher should have been applied since the URL is bypassed by NO_PROXY
  expect((captured.init as CapturedInit).dispatcher).toBe(fakeDispatcher)
  // The proxy option must NOT be present — bypassed requests must go direct
  expect((captured.init as CapturedInit).proxy).toBeUndefined()

  delete process.env.NO_PROXY
})

test('fetchWithProxyRetry passes proxy option and drops scoped dispatcher when URL is not in NO_PROXY', async () => {
  // Complementary to the bypass test: when the URL is not excluded by NO_PROXY,
  // the proxy env var should flow through and the scoped dispatcher must be dropped
  // to avoid conflicting with the proxy tunnel's own DNS resolution.
  process.env.HTTPS_PROXY = 'http://127.0.0.1:15236'
  delete process.env.NO_PROXY

  let capturedInit: RequestInit | undefined
  globalThis.fetch = (async (_input, init) => {
    capturedInit = init
    return new Response('ok')
  }) as FetchType

  const fakeDispatcher = { fake: true } as unknown as import('undici').Dispatcher

  await fetchWithProxyRetry('https://api.example.com/v1/chat', undefined, {
    dispatcher: fakeDispatcher,
  })

  type CapturedInit = RequestInit & { dispatcher?: unknown; proxy?: string }
  // proxy should be forwarded to fetch since the URL is NOT bypassed
  expect((capturedInit as CapturedInit).proxy).toBe('http://127.0.0.1:15236')
  // the scoped dispatcher must be dropped — proxy tunnel handles DNS
  expect((capturedInit as CapturedInit).dispatcher).toBeUndefined()
})

test('fetchWithProxyRetry preserves original hostname in URL for TLS SNI when dispatcher is used', async () => {
  // Regression for TLS/SNI breakage: the old Bun path rewrote the URL from
  // https://opengateway.gitlawb.com/... to https://<ipv4>/... which broke
  // TLS certificate validation (SNI sent the IP, not the hostname).
  // The fix keeps the original hostname URL and uses the dispatcher's
  // custom DNS lookup to force IPv4 resolution at the transport layer.
  process.env.HTTPS_PROXY = 'http://127.0.0.1:15236'
  process.env.NO_PROXY = 'opengateway.gitlawb.com'

  const captured = createCapturingFetch()
  const fakeDispatcher = { fake: true } as unknown as import('undici').Dispatcher

  // Pass the original hostname URL — it should NOT be rewritten to an IP.
  // The dispatcher handles IPv4 DNS resolution internally.
  await fetchWithProxyRetry('https://opengateway.gitlawb.com/v1/chat/completions', undefined, {
    dispatcher: fakeDispatcher,
  })

  // The URL must keep the original hostname — TLS SNI derives from the URL hostname,
  // so rewriting to an IP would break certificate validation.
  expect(captured.url).toBe('https://opengateway.gitlawb.com/v1/chat/completions')

  type CapturedInit = RequestInit & { dispatcher?: unknown; proxy?: string }
  // The scoped dispatcher must be applied — NO_PROXY matched the hostname
  expect((captured.init as CapturedInit).dispatcher).toBe(fakeDispatcher)
  // No proxy — bypassed by NO_PROXY
  expect((captured.init as CapturedInit).proxy).toBeUndefined()

  delete process.env.NO_PROXY
})
