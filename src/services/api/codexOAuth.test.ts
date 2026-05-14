import { createServer } from 'node:http'

import { afterEach, expect, mock, test } from 'bun:test'
import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'

import { CodexOAuthService } from './codexOAuth.js'

afterEach(() => {
  mock.restore()
  restoreCodexOAuthTestIsolation()
})

type CodexOAuthTestSnapshot = {
  fetch: typeof globalThis.fetch
  callbackPort: string | undefined
  callbackHost: string | undefined
  clientId: string | undefined
}

let activeSnapshot: CodexOAuthTestSnapshot | null = null

async function acquireCodexOAuthTestIsolation(): Promise<CodexOAuthTestSnapshot> {
  const result = await acquireEnvMutex()
  expect(result.acquired).toBe(true)

  activeSnapshot = {
    fetch: globalThis.fetch,
    callbackPort: process.env.CODEX_OAUTH_CALLBACK_PORT,
    callbackHost: process.env.CODEX_OAUTH_CALLBACK_HOST,
    clientId: process.env.CODEX_OAUTH_CLIENT_ID,
  }

  return activeSnapshot
}

function restoreCodexOAuthTestIsolation(): void {
  if (!activeSnapshot) {
    return
  }

  const snapshot = activeSnapshot
  activeSnapshot = null

  globalThis.fetch = snapshot.fetch

  if (snapshot.callbackPort === undefined) {
    delete process.env.CODEX_OAUTH_CALLBACK_PORT
  } else {
    process.env.CODEX_OAUTH_CALLBACK_PORT = snapshot.callbackPort
  }

  if (snapshot.callbackHost === undefined) {
    delete process.env.CODEX_OAUTH_CALLBACK_HOST
  } else {
    process.env.CODEX_OAUTH_CALLBACK_HOST = snapshot.callbackHost
  }

  if (snapshot.clientId === undefined) {
    delete process.env.CODEX_OAUTH_CLIENT_ID
  } else {
    process.env.CODEX_OAUTH_CLIENT_ID = snapshot.clientId
  }

  releaseEnvMutex()
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate test port.')))
        return
      }

      const { port } = address
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

function buildCallbackRequest(authUrl: string): string {
  const authorizeUrl = new URL(authUrl)
  const redirectUri = authorizeUrl.searchParams.get('redirect_uri')
  const state = authorizeUrl.searchParams.get('state')

  if (!redirectUri || !state) {
    throw new Error('Codex OAuth test did not receive a valid authorization URL.')
  }

  const callbackUrl = new URL(redirectUri)
  callbackUrl.searchParams.set('code', 'auth-code')
  callbackUrl.searchParams.set('state', state)
  return callbackUrl.toString()
}

test('serves updated success copy after a successful Codex OAuth flow', async () => {
  await acquireCodexOAuthTestIsolation()

  try {
    const callbackPort = await getFreePort()
    process.env.CODEX_OAUTH_CALLBACK_PORT = String(callbackPort)
    process.env.CODEX_OAUTH_CALLBACK_HOST = '127.0.0.1'
    process.env.CODEX_OAUTH_CLIENT_ID = 'test-client-id'

    globalThis.fetch = mock(async (input, init) => {
      const url = String(input)
      if (url.startsWith('http://localhost:')) {
        return activeSnapshot!.fetch(input, init)
      }

      return new Response(
        JSON.stringify({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }) as typeof fetch

    const service = new CodexOAuthService()
    let callbackResponsePromise!: Promise<Response>

    const flowPromise = service.startOAuthFlow(async authUrl => {
      callbackResponsePromise = activeSnapshot!.fetch(buildCallbackRequest(authUrl))
    })

    const tokens = await flowPromise
    const callbackResponse = await callbackResponsePromise
    const html = await callbackResponse.text()

    expect(tokens.accessToken).toBe('access-token')
    expect(tokens.refreshToken).toBe('refresh-token')
    expect(html).toContain('You can return to OpenClaude now.')
    expect(html).toContain(
      'OpenClaude will finish activating your new Codex OAuth login.',
    )
    expect(html).not.toContain('continue automatically')
  } finally {
    restoreCodexOAuthTestIsolation()
  }
})

test('cancellation during token exchange returns a cancelled page and rejects the flow', async () => {
  await acquireCodexOAuthTestIsolation()

  try {
    const callbackPort = await getFreePort()
    process.env.CODEX_OAUTH_CALLBACK_PORT = String(callbackPort)
    process.env.CODEX_OAUTH_CALLBACK_HOST = '127.0.0.1'
    process.env.CODEX_OAUTH_CLIENT_ID = 'test-client-id'

    let resolveFetchStart!: () => void
    const fetchStarted = new Promise<void>(resolve => {
      resolveFetchStart = resolve
    })

    globalThis.fetch = mock((input, init) => {
      const url = String(input)
      if (url.startsWith('http://localhost:')) {
        return activeSnapshot!.fetch(input, init)
      }

      return new Promise<Response>((_resolve, reject) => {
        resolveFetchStart()

        const signal = init?.signal
        if (!signal) {
          return
        }

        if (signal.aborted) {
          reject(signal.reason)
          return
        }

        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason)
          },
          { once: true },
        )
      })
    }) as typeof fetch

    const service = new CodexOAuthService()
    let callbackResponsePromise!: Promise<Response>

    const flowPromise = service.startOAuthFlow(async authUrl => {
      callbackResponsePromise = activeSnapshot!.fetch(buildCallbackRequest(authUrl))
    })

    await fetchStarted
    service.cleanup()

    await expect(flowPromise).rejects.toThrow('Codex OAuth flow was cancelled.')

    const callbackResponse = await callbackResponsePromise
    const html = await callbackResponse.text()

    expect(html).toContain('Codex login cancelled')
    expect(html).toContain('retry in OpenClaude')
  } finally {
    restoreCodexOAuthTestIsolation()
  }
})
