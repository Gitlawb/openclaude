import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { connect } from 'node:net'

import { acquireSharedMutationLock, releaseSharedMutationLock } from '../../test/sharedMutationLock.js'
import { startXaiOAuthCallback } from './xaiOAuthCallback.js'

async function startTestServer() {
  const handle = await startXaiOAuthCallback({
    port: 0,
    host: '127.0.0.1',
    callbackPath: '/callback',
    successTitle: 'xAI OAuth complete',
  })
  return { handle, port: handle.port }
}

type LoopbackResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

async function requestLoopback(
  port: number,
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: string
    timeoutMs?: number
  } = {},
): Promise<LoopbackResponse> {
  const method = options.method ?? 'GET'
  const body = options.body ?? ''
  const timeoutMs = options.timeoutMs ?? 2_000
  const headers = {
    Host: `127.0.0.1:${port}`,
    Connection: 'close',
    ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
    ...options.headers,
  }
  const requestText = [
    `${method} ${path} HTTP/1.1`,
    ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
    '',
    body,
  ].join('\r\n')

  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    const chunks: Buffer[] = []
    let settled = false

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(error)
    }

    socket.setTimeout(timeoutMs)

    socket.on('connect', () => {
      socket.write(requestText)
    })
    socket.on('data', chunk => {
      chunks.push(Buffer.from(chunk))
    })
    socket.on('timeout', () => {
      fail(new Error(`Loopback request timed out after ${timeoutMs}ms`))
    })
    socket.on('error', fail)
    socket.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8')
      const [head, ...bodyParts] = raw.split('\r\n\r\n')
      const [statusLine, ...headerLines] = head.split('\r\n')
      const status = Number(statusLine.split(' ')[1] ?? 0)
      const responseHeaders: Record<string, string> = {}
      for (const line of headerLines) {
        const separator = line.indexOf(':')
        if (separator < 0) continue
        responseHeaders[line.slice(0, separator).toLowerCase()] = line
          .slice(separator + 1)
          .trim()
      }
      resolve({
        status,
        headers: responseHeaders,
        body: bodyParts.join('\r\n\r\n'),
      })
    })
  })
}

describe.serial('startXaiOAuthCallback (CORS-aware loopback for xAI auth)', () => {
  let cleanup: (() => void) | null = null

  beforeEach(async () => {
    await acquireSharedMutationLock('xaiOAuthCallback.test.ts')
    cleanup = null
  })

  afterEach(() => {
    try {
      cleanup?.()
      cleanup = null
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('OPTIONS preflight from auth.x.ai returns 204 with CORS echo', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://auth.x.ai',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://auth.x.ai',
    )
    const allowMethods = res.headers['access-control-allow-methods'] ?? ''
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

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://auth.x.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-private-network']).toBe(
      'true',
    )
  })

  test('OPTIONS from accounts.x.ai is also allowed', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'https://accounts.x.ai' },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://accounts.x.ai',
    )
  })

  test('OPTIONS from untrusted origin gets 204 but no CORS headers', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('OPTIONS from http (non-https) x.ai is rejected', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'http://auth.x.ai' },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('OPTIONS from subdomain-spoof (auth.x.ai.evil.example.com) is rejected', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/callback', {
      method: 'OPTIONS',
      headers: { Origin: 'https://auth.x.ai.evil.example.com' },
    })
    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  test('GET /callback?code=&state= resolves waitForCallback with both', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await requestLoopback(
      port,
      '/callback?code=ABC123&state=xyz',
      { headers: { Origin: 'https://auth.x.ai' } },
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://auth.x.ai',
    )
    const result = await callbackPromise
    expect(result).toEqual({ code: 'ABC123', state: 'xyz' })
  })

  test('GET with ?error=access_denied rejects with a clear message', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await requestLoopback(port, '/callback?error=access_denied')
    expect(res.status).toBe(400)
    await expect(callbackPromise).rejects.toThrow(/access_denied/)
  })

  test('GET to wrong path returns 404 and does not settle the callback', async () => {
    const { handle, port } = await startTestServer()
    cleanup = () => handle.close()

    const res = await requestLoopback(port, '/something-else')
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

    const res = await requestLoopback(port, '/callback', {
      method: 'POST',
      body: 'code=ABC&state=xyz',
    })
    expect(res.status).toBe(405)
    expect(res.headers.allow ?? '').toContain('GET')
  })

  test('successTitle is HTML-escaped in the success page', async () => {
    const handle = await startXaiOAuthCallback({
      port: 0,
      host: '127.0.0.1',
      callbackPath: '/callback',
      successTitle: '<script>alert(1)</script>',
    })
    cleanup = () => handle.close()

    const callbackPromise = handle.waitForCallback()
    const res = await requestLoopback(handle.port, '/callback?code=A&state=B')
    const body = res.body
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
