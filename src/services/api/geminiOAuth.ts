import { AuthCodeListener } from '../oauth/auth-code-listener.js'
import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from '../oauth/crypto.js'
import {
  asTrimmedString,
  GEMINI_OAUTH_ISSUER,
  GEMINI_OAUTH_SCOPE,
  GEMINI_TOKEN_URL,
  escapeHtml,
  getGeminiOAuthCallbackPort,
  getGeminiOAuthClientId,
  GEMINI_OAUTH_CLIENT_SECRET,
} from './geminiOAuthShared.js'

type GeminiOAuthTokenResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

export type GeminiOAuthTokens = {
  accessToken: string
  refreshToken: string
  idToken?: string
  expiresIn?: number
}

function buildGeminiAuthorizeUrl(options: {
  port: number
  codeChallenge: string
  state: string
}): string {
  const redirectUri = `http://localhost:${options.port}/auth/callback`
  const authUrl = new URL(`${GEMINI_OAUTH_ISSUER}/o/oauth2/v2/auth`)

  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append('client_id', getGeminiOAuthClientId())
  authUrl.searchParams.append('redirect_uri', redirectUri)
  authUrl.searchParams.append('scope', GEMINI_OAUTH_SCOPE)
  authUrl.searchParams.append('code_challenge', options.codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('state', options.state)
  // Request offline access to get a refresh token
  authUrl.searchParams.append('access_type', 'offline')

  return authUrl.toString()
}

function renderSuccessPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="refresh" content="0;url=https://developers.google.com/gemini-code-assist/auth_success_gemini" />
    <title>Gemini Login Complete</title>
  </head>
  <body>
    <script>window.location.replace("https://developers.google.com/gemini-code-assist/auth_success_gemini");</script>
    <p>Redirecting to success page...</p>
  </body>
</html>`
}

function renderErrorPage(message: string): string {
  const safeMessage = escapeHtml(message)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Gemini Login Failed</title>
    <style>
      body { font-family: sans-serif; padding: 32px; line-height: 1.5; color: #111827; }
      h1 { margin: 0 0 12px; font-size: 22px; color: #991b1b; }
      p { margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <h1>Gemini login failed</h1>
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
    <title>Gemini Login Cancelled</title>
    <style>
      body { font-family: sans-serif; padding: 32px; line-height: 1.5; color: #111827; }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; }
    </style>
  </head>
  <body>
    <h1>Gemini login cancelled</h1>
    <p>You can close this window and retry in OpenClaude.</p>
  </body>
</html>`
}

async function exchangeAuthorizationCode(options: {
  authorizationCode: string
  codeVerifier: string
  port: number
  signal?: AbortSignal
}): Promise<GeminiOAuthTokens> {
  const redirectUri = `http://localhost:${options.port}/auth/callback`
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.authorizationCode,
    redirect_uri: redirectUri,
    client_id: getGeminiOAuthClientId(),
    client_secret: GEMINI_OAUTH_CLIENT_SECRET,
    code_verifier: options.codeVerifier,
  })

  const response = await fetch(GEMINI_TOKEN_URL, {
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
        ? `Gemini OAuth token exchange failed (${response.status}): ${errorText.trim()}`
        : `Gemini OAuth token exchange failed with status ${response.status}.`,
    )
  }

  const payload = (await response.json()) as GeminiOAuthTokenResponse
  const accessToken = asTrimmedString(payload.access_token)
  
  if (!accessToken) {
    throw new Error(
      'Gemini OAuth completed, but the token response was missing access token.',
    )
  }

  return {
    accessToken,
    refreshToken: asTrimmedString(payload.refresh_token) || '',
    idToken: asTrimmedString(payload.id_token),
    expiresIn: payload.expires_in,
  }
}

export class GeminiOAuthService {
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private tokenExchangeAbortController: AbortController | null = null

  private buildCancellationError(): Error {
    return new Error('Gemini OAuth flow was cancelled.')
  }

  async startOAuthFlow(
    authURLHandler: (authUrl: string) => Promise<void>,
  ): Promise<GeminiOAuthTokens> {
    const codeVerifier = generateCodeVerifier()
    const callbackPort = getGeminiOAuthCallbackPort()
    const authCodeListener = new AuthCodeListener('/auth/callback')

    this.authCodeListener = authCodeListener
    this.port = null

    try {
      const port = await authCodeListener.start(callbackPort)
      this.port = port

      const state = generateState()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      const authUrl = buildGeminiAuthorizeUrl({
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

        let tokens: GeminiOAuthTokens
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
            resolvedError.message === 'Gemini OAuth flow was cancelled.'

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
          `Gemini OAuth needs localhost:${callbackPort} for its callback. Close any app already using that port and try again.`,
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
