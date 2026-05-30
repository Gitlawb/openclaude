import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fetch as httpFetch } from 'undici'

import { startXaiOAuthCallback } from './xaiOAuthCallback.js'

/**
 * Acquire an OS-assigned ephemeral port the test can hand back. Bun's test
 * runner can pile concurrent files; we don't want them stomping on each
 * other or on a developer's actual 56121.
 */
async function getEphemeralPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

async function startTestServer() {
  const port = await getEphemeralPort()
  const handle = await startXaiOAuthCallback({
    port,
    host: '127.0.0.1',
    callbackPath: '/callback',
    successTitle: 'xAI OAuth complete',
  })
  return { handle, port }
}

describe.serial('startXaiOAuthCallback (CORS-aware loopback for xAI auth)', () => {
  let cleanup: (() => void) | null = null
  let savedProxyEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    cleanup = null
    savedProxyEnv = {
      HTTP_PROXY: process.env.HTTP_PROXY,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      ALL_PROXY: process.env.ALL_PROXY,
      NO_PROXY: process.env.NO_PROXY,
    }
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.ALL_PROXY
    process.env.NO_PROXY = '127.0.0.1,localhost'
  })

  afterEach(() => {
    cleanup?.()
    cleanup = null
    for (const [key, value] of Object.entries(savedProxyEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    savedProxyEnv = {}
  })

  test('OPTIONS preflight from auth.x.ai returns 204 with CORS echo', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://auth.x.ai',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://auth.x.ai',
    )
    const allowMethods = res.headers.get('access-control-allow-methods') ?? ''
    expect(allowMethods).toContain('GET')
    // Don't leak the callback resolution to OPTIONS — the wait promise
    // shouldn't have settled.
    let settled = false
    void handle.waitForCallback().then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await Bun.sleep(20)
    expect(settled).toBe(false)
  })

  // Without this header, Chrome/Edge block xAI's HTTPS-origin fetch to
  // the loopback callback. The preflight succeeds, the actual GET never
  // fires, the CLI never auto-detects success, and the user has to fall
  // back to manual code paste. Regression-locked because this is silent
  // — the only symptom is "auto-detect doesn't work".
  test('OPTIONS preflight includes Access-Control-Allow-Private-Network', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://auth.x.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-private-network')).toBe(
      'true',
    )
  })

  test('OPTIONS from accounts.x.ai is also allowed', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://accounts.x.ai' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://accounts.x.ai',
    )
  })

  test('OPTIONS from untrusted origin gets 204 but no CORS headers', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('OPTIONS from http (non-https) x.ai is rejected', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://auth.x.ai' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('OPTIONS from subdomain-spoof (auth.x.ai.evil.example.com) is rejected', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://auth.x.ai.evil.example.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('GET /callback?code=&state= resolves waitForCallback with both', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await httpFetch(
      `http://127.0.0.1:${port}/callback?code=ABC123&state=xyz`,
      { headers: { Origin: 'https://auth.x.ai' } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://auth.x.ai',
    )
    const result = await callbackPromise
    expect(result).toEqual({ code: 'ABC123', state: 'xyz' })
  })

  test('GET with ?error=access_denied rejects with a clear message', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await httpFetch(
      `http://127.0.0.1:${port}/callback?error=access_denied`,
    )
    expect(res.status).toBe(400)
    await expect(callbackPromise).rejects.toThrow(/access_denied/)
  })

  test('GET to wrong path returns 404 and does not settle the callback', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/something-else`)
    expect(res.status).toBe(404)

    let settled = false
    void handle.waitForCallback().then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    await Bun.sleep(20)
    expect(settled).toBe(false)
  })

  test('POST to /callback returns 405 with Allow header', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await httpFetch(`http://127.0.0.1:${port}/callback`, {
      method: 'POST',
      body: 'code=ABC&state=xyz',
    })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow') ?? '').toContain('GET')
  })

  test('successTitle is HTML-escaped in the success page', async () => {
    const port = await getEphemeralPort()
    const handle = await startXaiOAuthCallback({
      port,
      host: '127.0.0.1',
      callbackPath: '/callback',
      successTitle: '<script>alert(1)</script>',
    })
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await httpFetch(
      `http://127.0.0.1:${port}/callback?code=A&state=B`,
    )
    const body = await res.text()
    expect(body).not.toContain('<script>alert(1)</script>')
    expect(body).toContain('&lt;script&gt;')
    await callbackPromise
  })

  test('close() before callback rejects waitForCallback', async () => {
    const { handle } = await startTestServer()
    const callbackPromise = handle.waitForCallback()
    // Attach a no-op catch FIRST so the microtask rejection doesn't surface
    // as unhandled before the assertion is in place.
    callbackPromise.catch(() => undefined)
    handle.close()
    await expect(callbackPromise).rejects.toThrow(/closed/)
  })
})
