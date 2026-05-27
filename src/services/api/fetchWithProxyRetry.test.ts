import { afterEach, beforeEach, expect, test } from 'bun:test'
import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'

import { _resetKeepAliveForTesting } from '../../utils/proxy.js'
import {
  fetchWithProxyRetry,
  isRetryableFetchError,
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

beforeEach(async () => {
  await acquireSharedMutationLock('fetchWithProxyRetry.test.ts')
  process.env.HTTP_PROXY = 'http://127.0.0.1:15236'
  delete process.env.HTTPS_PROXY
  _resetKeepAliveForTesting()
})

afterEach(() => {
  try {
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

  let capturedInit: RequestInit | undefined
  globalThis.fetch = (async (_input, init) => {
    capturedInit = init
    return new Response('ok')
  }) as FetchType

  const fakeDispatcher = { fake: true } as unknown as import('undici').Dispatcher

  await fetchWithProxyRetry('https://opengateway.gitlawb.com/v1/chat', undefined, {
    dispatcher: fakeDispatcher,
  })

  type CapturedInit = RequestInit & { dispatcher?: unknown; proxy?: string }
  // The scoped dispatcher should have been applied since the URL is bypassed by NO_PROXY
  expect((capturedInit as CapturedInit).dispatcher).toBe(fakeDispatcher)
  // The proxy option must NOT be present — bypassed requests must go direct
  expect((capturedInit as CapturedInit).proxy).toBeUndefined()

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
