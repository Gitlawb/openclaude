import { afterEach, expect, mock, test } from 'bun:test'
import { acquireEnvMutex, releaseEnvMutex } from '../../entrypoints/sdk/shared.js'
import { CodexOAuthService } from './codexOAuth.js'

type CodexOAuthTestSnapshot = {
  fetch: typeof globalThis.fetch
  callbackPort: string | undefined
  callbackHost: string | undefined
  clientId: string | undefined
}

type FakeResponseCapture = {
  body: string
  headers: Record<string, string>
  statusCode: number | null
}

type FakeServerResponse = {
  destroyed: boolean
  headersSent: boolean
  writableEnded: boolean
  writeHead: (statusCode: number, headers?: Record<string, string>) => void
  end: (chunk?: string) => void
}

type FakeAuthCodeListenerInstance = {
  callbackPath: string
  capture: FakeResponseCapture | null
  cancelCalls: Error[]
  closeCalls: number
  hasPendingResponse: () => boolean
  start: (port?: number, host?: string) => Promise<number>
  waitForAuthorization: (
    state: string,
    onReady: () => Promise<void>,
  ) => Promise<string>
  handleSuccessRedirect: (
    scopes: string[],
    customHandler?: (res: FakeServerResponse, scopes: string[]) => void,
  ) => void
  handleErrorRedirect: (customHandler?: (res: FakeServerResponse) => void) => void
  cancelPendingAuthorization: (error?: Error) => void
  close: () => void
}

let activeSnapshot: CodexOAuthTestSnapshot | null = null
let fakeListenerInstance: FakeAuthCodeListenerInstance | null = null
let nextFakePort = 41000

function createFakeServerResponse(capture: FakeResponseCapture): FakeServerResponse {
  return {
    destroyed: false,
    headersSent: false,
    writableEnded: false,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      capture.statusCode = statusCode
      capture.headers = { ...(headers ?? {}) }
      this.headersSent = true
    },
    end(chunk?: string) {
      if (chunk) {
        capture.body += chunk
      }
      this.writableEnded = true
    },
  }
}

function createFakeAuthCodeListener(callbackPath: string): FakeAuthCodeListenerInstance {
  fakeListenerInstance = null
  class FakeAuthCodeListener {
    callbackPath: string
    capture: FakeResponseCapture | null = null
    cancelCalls: Error[] = []
    closeCalls = 0
    private pending = false
    private boundPort = 0
    private boundHost = 'localhost'

    constructor(callbackPath: string = '/callback') {
      this.callbackPath = callbackPath
      fakeListenerInstance = this as unknown as FakeAuthCodeListenerInstance
    }

    hasPendingResponse(): boolean {
      return this.pending
    }

    async start(port?: number, host: string = 'localhost'): Promise<number> {
      this.boundHost = host
      this.boundPort = port && port > 0 ? port : nextFakePort++
      return this.boundPort
    }

    async waitForAuthorization(
      state: string,
      onReady: () => Promise<void>,
    ): Promise<string> {
      this.pending = true
      this.capture = { body: '', headers: {}, statusCode: null }
      await onReady()
      void state
      return 'auth-code'
    }

    handleSuccessRedirect(
      scopes: string[],
      customHandler?: (res: FakeServerResponse, scopes: string[]) => void,
    ): void {
      if (!this.pending || !this.capture) {
        return
      }

      const res = createFakeServerResponse(this.capture)
      customHandler?.(res, scopes)
      if (!res.writableEnded) {
        res.end()
      }
      this.pending = false
    }

    handleErrorRedirect(
      customHandler?: (res: FakeServerResponse) => void,
    ): void {
      if (!this.pending || !this.capture) {
        return
      }

      const res = createFakeServerResponse(this.capture)
      customHandler?.(res)
      if (!res.writableEnded) {
        res.end()
      }
      this.pending = false
    }

    cancelPendingAuthorization(
      error: Error = new Error('OAuth authorization was cancelled.'),
    ): void {
      this.cancelCalls.push(error)
    }

    close(): void {
      this.closeCalls += 1
      this.pending = false
    }
  }

  return new FakeAuthCodeListener(callbackPath) as FakeAuthCodeListenerInstance
}

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
  fakeListenerInstance = null

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

afterEach(() => {
  mock.restore()
  restoreCodexOAuthTestIsolation()
})

test('serves updated success copy after a successful Codex OAuth flow', async () => {
  await acquireCodexOAuthTestIsolation()

  try {
    process.env.CODEX_OAUTH_CLIENT_ID = 'test-client-id'

    globalThis.fetch = mock(async () => {
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

    const service = new CodexOAuthService({
      callbackPort: 0,
      callbackHost: '127.0.0.1',
      createAuthCodeListener: createFakeAuthCodeListener,
    })

    let capturedAuthUrl = ''
    const tokens = await service.startOAuthFlow(async authUrl => {
      capturedAuthUrl = authUrl
    })

    expect(tokens.accessToken).toBe('access-token')
    expect(tokens.refreshToken).toBe('refresh-token')
    expect(capturedAuthUrl).toContain('client_id=test-client-id')
    expect(capturedAuthUrl).toContain(
      encodeURIComponent('http://127.0.0.1:41000/auth/callback'),
    )
    expect(fakeListenerInstance?.capture?.statusCode).toBe(200)
    expect(fakeListenerInstance?.capture?.body).toContain(
      'You can return to OpenClaude now.',
    )
    expect(fakeListenerInstance?.capture?.body).toContain(
      'OpenClaude will finish activating your new Codex OAuth login.',
    )
    expect(fakeListenerInstance?.capture?.body).not.toContain(
      'continue automatically',
    )
  } finally {
    restoreCodexOAuthTestIsolation()
  }
})

test('cancellation during token exchange returns a cancelled page and rejects the flow', async () => {
  await acquireCodexOAuthTestIsolation()

  try {
    process.env.CODEX_OAUTH_CLIENT_ID = 'test-client-id'

    let resolveFetchStart!: () => void
    const fetchStarted = new Promise<void>(resolve => {
      resolveFetchStart = resolve
    })

    globalThis.fetch = mock((_input, init) => {
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

    const service = new CodexOAuthService({
      callbackPort: 0,
      callbackHost: '127.0.0.1',
      createAuthCodeListener: createFakeAuthCodeListener,
    })

    const flowPromise = service.startOAuthFlow(async () => {})

    await fetchStarted
    service.cleanup()

    await expect(flowPromise).rejects.toThrow('Codex OAuth flow was cancelled.')
    expect(fakeListenerInstance?.capture?.statusCode).toBe(200)
    expect(fakeListenerInstance?.capture?.body).toContain(
      'Codex login cancelled',
    )
    expect(fakeListenerInstance?.capture?.body).toContain(
      'retry in OpenClaude',
    )
  } finally {
    restoreCodexOAuthTestIsolation()
  }
})
