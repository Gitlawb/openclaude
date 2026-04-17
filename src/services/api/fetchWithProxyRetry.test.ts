import { afterEach, beforeEach, expect, test } from 'bun:test'

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

beforeEach(() => {
  process.env.HTTP_PROXY = 'http://127.0.0.1:15236'
  delete process.env.HTTPS_PROXY
  _resetKeepAliveForTesting()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  restoreEnv('HTTP_PROXY', originalEnv.HTTP_PROXY)
  restoreEnv('HTTPS_PROXY', originalEnv.HTTPS_PROXY)
  _resetKeepAliveForTesting()
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
