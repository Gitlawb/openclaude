import { AuthCodeListener } from '../oauth/auth-code-listener.js'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../oauth/crypto.js'
import {
  asTrimmedString,
  CODEX_OAUTH_ISSUER,
  CODEX_OAUTH_ORIGINATOR,
  CODEX_OAUTH_SCOPE,
  escapeHtml,
  getCodexOAuthCallbackHost,
  getCodexOAuthCallbackOrigin,
  exchangeCodexIdTokenForApiKey,
  getCodexOAuthCallbackPort,
  getCodexOAuthClientId,
  parseChatgptAccountId,
} from './codexOAuthShared.js'
import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'

type CodexOAuthTokenResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

export type CodexOAuthTokens = {
  apiKey?: string
  accessToken: string
  refreshToken: string
  idToken?: string
  accountId?: string
}

function buildCodexAuthorizeUrl(options: {
  port: number
  host: string
  codeChallenge: string
  state: string
}): string {
  const redirectUri = `${getCodexOAuthCallbackOrigin(options.port, {
    CODEX_OAUTH_CALLBACK_HOST: options.host,
  } as NodeJS.ProcessEnv)}/auth/callback`
  const authUrl = new URL(`${CODEX_OAUTH_ISSUER}/oauth/authorize`)

  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append('client_id', getCodexOAuthClientId())
  authUrl.searchParams.append('redirect_uri', redirectUri)
  authUrl.searchParams.append('scope', CODEX_OAUTH_SCOPE)
  authUrl.searchParams.append('code_challenge', options.codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('id_token_add_organizations', 'true')
  authUrl.searchParams.append('codex_cli_simplified_flow', 'true')
  authUrl.searchParams.append('state', options.state)
  authUrl.searchParams.append('originator', CODEX_OAUTH_ORIGINATOR)

  return authUrl.toString()
}

function renderSuccessPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Codex Login Complete</title>
    <style>
      body { font-family: sans-serif; padding: 32px; line-height: 1.5; color: #111827; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <h1>Codex login complete</h1>
    <p>You can return to OpenClaude now.</p>
    <p>OpenClaude will finish activating your new Codex OAuth login.</p>
  </body>
</html>`
}

function renderErrorPage(message: string): string {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Codex Login Failed</title>
    <style>
      body { font-family: sans-serif; padding: 32px; line-height: 1.5; color: #111827; }
      h1 { margin: 0 0 12px; font-size: 22px; color: #991b1b; }
      p { margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <h1>Codex login failed</h1>
    <p>${safeMessage}</p>
    <p>You can close this window and try again in OpenClaude.</p>
  </body>
</html>`
}

function renderCancelledPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Codex Login Cancelled</title>
    <style>
      body { font-family: sans-serif; padding: 32px; line-height: 1.5; color: #111827; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <h1>Codex login cancelled</h1>
    <p>You can close this window and retry in OpenClaude.</p>
  </body>
</html>`
}

async function exchangeAuthorizationCode(options: {
  authorizationCode: string
  codeVerifier: string
  port: number
  host: string
  signal?: AbortSignal
}): Promise<CodexOAuthTokens> {
  const redirectUri = `${getCodexOAuthCallbackOrigin(options.port, {
    CODEX_OAUTH_CALLBACK_HOST: options.host,
  } as NodeJS.ProcessEnv)}/auth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.authorizationCode,
    redirect_uri: redirectUri,
    client_id: getCodexOAuthClientId(),
    code_verifier: options.codeVerifier,
  })

  const { signal, cleanup } = createCombinedAbortSignal(options.signal, {
    timeoutMs: 15_000,
  })
  let payload: CodexOAuthTokenResponse
  try {
    const response = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(
        errorText.trim()
          ? `Codex OAuth token exchange failed (${response.status}): ${errorText.trim()}`
          : `Codex OAuth token exchange failed with status ${response.status}.`,
      )
    }

    payload = (await response.json()) as CodexOAuthTokenResponse
  } finally {
    cleanup()
  }

  const accessToken = asTrimmedString(payload.access_token)
  const refreshToken = asTrimmedString(payload.refresh_token)
  if (!accessToken || !refreshToken) {
    throw new Error(
      'Codex OAuth completed, but the token response was missing credentials.',
    )
  }

  const idToken = asTrimmedString(payload.id_token)
  const apiKey = idToken
    ? await exchangeCodexIdTokenForApiKey(idToken).catch(() => undefined)
    : undefined

  return {
    apiKey,
    accessToken,
    refreshToken,
    idToken,
    accountId:
      parseChatgptAccountId(idToken) ?? parseChatgptAccountId(accessToken),
  }
}

type CodexOAuthServiceOptions = {
  callbackPort?: number
  callbackHost?: string
  createAuthCodeListener?: (callbackPath: string) => CodexOAuthListener
}

type CodexOAuthListener = Pick<
  AuthCodeListener,
  | 'start'
  | 'hasPendingResponse'
  | 'waitForAuthorization'
  | 'handleSuccessRedirect'
  | 'handleErrorRedirect'
  | 'cancelPendingAuthorization'
>

export type CodexManualCallbackResult =
  | { ok: true }
  | { ok: false; error: string }

export class CodexOAuthService {
  private authCodeListener: CodexOAuthListener | null = null
  private port: number | null = null
  private tokenExchangeAbortController: AbortController | null = null
  private manualResolver: ((authorizationCode: string) => void) | null = null
  private manualRejecter: ((error: Error) => void) | null = null
  private expectedState: string | null = null

  constructor(private readonly options: CodexOAuthServiceOptions = {}) {}

  private buildCancellationError(): Error {
    return new Error('Codex OAuth flow was cancelled.')
  }

  /**
   * Recover the flow when the loopback callback is unreachable — typically a
   * remote SSH session where the user's browser redirects to a localhost URL
   * that resolves to their workstation, not the openclaude host. The user
   * pastes the full redirected URL (or just its query string), we validate
   * the state parameter against the in-flight flow, and resolve the same
   * authorization code the loopback path would have produced.
   *
   * Returns a structured outcome instead of throwing so the UI layer can
   * surface parse / state errors inline without unmounting the flow.
   */
  submitManualCallback(input: string): CodexManualCallbackResult {
    const trimmed = input.trim()
    if (!trimmed) {
      return { ok: false, error: 'Paste the callback URL or its query string.' }
    }
    if (!this.manualResolver || !this.expectedState) {
      return {
        ok: false,
        error: 'No Codex OAuth flow is waiting for a manual callback.',
      }
    }

    let searchParams: URLSearchParams
    try {
      if (trimmed.includes('://')) {
        searchParams = new URL(trimmed).searchParams
      } else {
        searchParams = new URLSearchParams(
          trimmed.startsWith('?') ? trimmed.slice(1) : trimmed,
        )
      }
    } catch {
      return {
        ok: false,
        error: 'Could not parse the callback URL — paste the full address.',
      }
    }

    const code = asTrimmedString(searchParams.get('code') ?? undefined)
    const state = asTrimmedString(searchParams.get('state') ?? undefined)
    const errorParam = asTrimmedString(searchParams.get('error') ?? undefined)
    if (errorParam) {
      const description = asTrimmedString(
        searchParams.get('error_description') ?? undefined,
      )
      return {
        ok: false,
        error: description
          ? `Authorization failed: ${errorParam} — ${description}`
          : `Authorization failed: ${errorParam}`,
      }
    }
    if (!code) {
      return { ok: false, error: 'Callback URL is missing the `code` parameter.' }
    }
    if (!state) {
      return {
        ok: false,
        error: 'Callback URL is missing the `state` parameter.',
      }
    }
    if (state !== this.expectedState) {
      return {
        ok: false,
        error:
          'State mismatch — the URL is from a different login attempt. Start over.',
      }
    }

    const resolver = this.manualResolver
    this.manualResolver = null
    this.manualRejecter = null
    resolver(code)
    return { ok: true }
  }

  async startOAuthFlow(
    authURLHandler: (authUrl: string) => Promise<void>,
  ): Promise<CodexOAuthTokens> {
    const codeVerifier = generateCodeVerifier()
    const callbackPort =
      this.options.callbackPort ?? getCodexOAuthCallbackPort()
    const callbackHost =
      this.options.callbackHost ?? getCodexOAuthCallbackHost()
    const authCodeListener =
      this.options.createAuthCodeListener?.('/auth/callback') ??
      new AuthCodeListener('/auth/callback')

    this.authCodeListener = authCodeListener
    this.port = null

    try {
      const port = await authCodeListener.start(callbackPort, callbackHost)
      this.port = port

      const state = generateState()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      const authUrl = buildCodexAuthorizeUrl({
        port,
        host: callbackHost,
        codeChallenge,
        state,
      })

      this.expectedState = state
      const manualPromise = new Promise<string>((resolve, reject) => {
        this.manualResolver = resolve
        this.manualRejecter = reject
      })
      // Manual path may never be taken; swallow its rejection (raised from
      // cleanup()) so it doesn't bubble as an unhandledRejection when the
      // loopback wins the race.
      manualPromise.catch(() => undefined)

      try {
        const loopbackPromise = authCodeListener.waitForAuthorization(
          state,
          async () => {
            await authURLHandler(authUrl)
          },
        )
        loopbackPromise.catch(() => undefined)

        const authorizationCode = await Promise.race([
          loopbackPromise,
          manualPromise,
        ])

        const tokenExchangeAbortController = new AbortController()
        this.tokenExchangeAbortController = tokenExchangeAbortController

        let tokens: CodexOAuthTokens
        try {
          tokens = await exchangeAuthorizationCode({
            authorizationCode,
            codeVerifier,
            port,
            host: callbackHost,
            signal: tokenExchangeAbortController.signal,
          })
        } finally {
          if (
            this.tokenExchangeAbortController === tokenExchangeAbortController
          ) {
            this.tokenExchangeAbortController = null
          }
        }

        if (this.authCodeListener !== authCodeListener) {
          throw this.buildCancellationError()
        }

        authCodeListener.handleSuccessRedirect([], res => {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
          })
          res.end(renderSuccessPage())
        })

        return tokens
      } catch (error) {
        const resolvedError =
          this.authCodeListener === authCodeListener
            ? error
            : this.buildCancellationError()

        if (authCodeListener.hasPendingResponse()) {
          const isCancellation =
            resolvedError instanceof Error &&
            resolvedError.message === 'Codex OAuth flow was cancelled.'

          authCodeListener.handleErrorRedirect(res => {
            res.writeHead(isCancellation ? 200 : 400, {
              'Content-Type': 'text/html; charset=utf-8',
            })
            res.end(
              isCancellation
                ? renderCancelledPage()
                : renderErrorPage(
                    resolvedError instanceof Error
                      ? resolvedError.message
                      : String(resolvedError),
                  ),
            )
          })
        }
        throw resolvedError
      } finally {
        this.cleanup()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes('EADDRINUSE') ||
        message.includes(String(callbackPort))
      ) {
        throw new Error(
          `Codex OAuth needs ${callbackHost}:${callbackPort} for its callback. Close any app already using that port and try again.`,
        )
      }
      throw error
    }
  }

  cleanup(): void {
    const cancellationError = this.buildCancellationError()

    this.tokenExchangeAbortController?.abort(cancellationError)
    this.tokenExchangeAbortController = null

    if (this.authCodeListener?.hasPendingResponse()) {
      this.authCodeListener.handleErrorRedirect(res => {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
        })
        res.end(renderCancelledPage())
      })
    }

    this.authCodeListener?.cancelPendingAuthorization(cancellationError)
    this.authCodeListener = null
    this.port = null

    // Unblock any caller awaiting Promise.race against the manual path so the
    // race resolves to the listener's rejection (or to this cancellation)
    // instead of hanging forever.
    this.manualRejecter?.(cancellationError)
    this.manualResolver = null
    this.manualRejecter = null
    this.expectedState = null
  }
}
