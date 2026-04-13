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
  exchangeCodexIdTokenForApiKey,
  getCodexOAuthCallbackPort,
  getCodexOAuthClientId,
  parseChatgptAccountId,
} from './codexOAuthShared.js'

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
  codeChallenge: string
  state: string
}): string {
  const redirectUri = `http://localhost:${options.port}/auth/callback`
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
  signal?: AbortSignal
}): Promise<CodexOAuthTokens> {
  const redirectUri = `http://localhost:${options.port}/auth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.authorizationCode,
    redirect_uri: redirectUri,
    client_id: getCodexOAuthClientId(),
    code_verifier: options.codeVerifier,
  })

  const response = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      errorText.trim()
        ? `Codex OAuth token exchange failed (${response.status}): ${errorText.trim()}`
        : `Codex OAuth token exchange failed with status ${response.status}.`,
    )
  }

  const payload = (await response.json()) as CodexOAuthTokenResponse
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

export class CodexOAuthService {
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private tokenExchangeAbortController: AbortController | null = null

  private buildCancellationError(): Error {
    return new Error('Codex OAuth flow was cancelled.')
  }

  async startOAuthFlow(
    authURLHandler: (authUrl: string) => Promise<void>,
  ): Promise<CodexOAuthTokens> {
    const codeVerifier = generateCodeVerifier()
    const callbackPort = getCodexOAuthCallbackPort()
    const authCodeListener = new AuthCodeListener('/auth/callback')

    this.authCodeListener = authCodeListener
    this.port = null

    try {
      const port = await authCodeListener.start(callbackPort)
      this.port = port

      const state = generateState()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      const authUrl = buildCodexAuthorizeUrl({
        port,
        codeChallenge,
        state,
      })

      try {
        const authorizationCode = await authCodeListener.waitForAuthorization(
          state,
          async () => {
            await authURLHandler(authUrl)
          },
        )

        const tokenExchangeAbortController = new AbortController()
        this.tokenExchangeAbortController = tokenExchangeAbortController

        let tokens: CodexOAuthTokens
        try {
          tokens = await exchangeAuthorizationCode({
            authorizationCode,
            codeVerifier,
            port,
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
          `Codex OAuth needs localhost:${callbackPort} for its callback. Close any app already using that port and try again.`,
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
  }
}
