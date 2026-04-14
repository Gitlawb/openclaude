/**
 * Qwen OAuth Service — Device Code Flow with PKCE.
 *
 * Follows the exact same pattern as CodexOAuthService:
 * - Generates PKCE pair (code_verifier + code_challenge)
 * - Requests device code from Qwen OAuth server
 * - Opens browser via authURLHandler
 * - Polls for token with backoff
 * - Returns credentials on success
 */

import { randomBytes, createHash } from 'node:crypto'

const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/device/code'
const QWEN_OAUTH_TOKEN_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/token'
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion'

export type QwenOAuthTokens = {
  accessToken: string
  refreshToken: string
  tokenType: string
  resourceUrl: string
  expiryDate: number
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

function generateCodeChallenge(codeVerifier: string): string {
  const hash = createHash('sha256')
  hash.update(codeVerifier)
  return hash.digest('base64url')
}

function objectToUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

type QwenDeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval?: number
}

/**
 * Qwen OAuth Service for device code flow.
 * Usage:
 *   const service = new QwenOAuthService()
 *   const tokens = await service.startOAuthFlow(async (authUrl) => {
 *     await openBrowser(authUrl)
 *   })
 */
export class QwenOAuthService {
  private inFlightPoll: AbortController | null = null

  async startOAuthFlow(
    authURLHandler: (url: string, userCode: string) => Promise<void>,
  ): Promise<QwenOAuthTokens> {
    // Generate PKCE
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    // Request device code
    const deviceCode = await this.requestDeviceCode(codeChallenge)

    // Open browser
    await authURLHandler(deviceCode.verification_uri_complete, deviceCode.user_code)

    // Poll for token
    return this.pollForToken(deviceCode, codeVerifier)
  }

  private async requestDeviceCode(codeChallenge: string): Promise<QwenDeviceCodeResponse> {
    const body = objectToUrlEncoded({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Device authorization failed: ${response.status} — ${text}`)
    }

    const data = await response.json()
    if (!data.device_code) {
      throw new Error(`Device authorization failed: ${(data as any).error || 'Unknown error'}`)
    }

    return data as QwenDeviceCodeResponse
  }

  private async pollForToken(
    deviceCode: QwenDeviceCodeResponse,
    codeVerifier: string,
  ): Promise<QwenOAuthTokens> {
    const pollInterval = 2000
    const maxAttempts = Math.ceil(deviceCode.expires_in / (pollInterval / 1000))

    this.inFlightPoll = new AbortController()

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.inFlightPoll.signal.aborted) {
        throw new Error('OAuth flow cancelled')
      }

      const body = objectToUrlEncoded({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: QWEN_OAUTH_CLIENT_ID,
        device_code: deviceCode.device_code,
        code_verifier: codeVerifier,
      })

      const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body,
      })

      const text = await response.text()
      let data: Record<string, unknown>
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error(`Token poll failed: ${response.status} — ${text}`)
      }

      // authorization_pending — keep polling
      if (response.status === 400 && data.error === 'authorization_pending') {
        await new Promise((r) => setTimeout(r, pollInterval))
        continue
      }

      // slow_down — increase interval
      if (response.status === 429 && data.error === 'slow_down') {
        await new Promise((r) => setTimeout(r, Math.min(pollInterval * 1.5, 10000)))
        continue
      }

      // Success
      if (response.ok && data.access_token) {
        this.inFlightPoll = null
        return {
          accessToken: data.access_token as string,
          refreshToken: (data.refresh_token as string) || '',
          tokenType: (data.token_type as string) || 'Bearer',
          resourceUrl: (data.resource_url as string) || 'portal.qwen.ai',
          expiryDate: data.expires_in
            ? Date.now() + (data.expires_in as number) * 1000
            : Date.now() + 3600_000,
        }
      }

      // Other error
      this.inFlightPoll = null
      throw new Error(`Token poll failed: ${(data as any).error || 'Unknown error'}`)
    }

    this.inFlightPoll = null
    throw new Error('Authorization timed out. Please try again.')
  }

  /**
   * Cancel the current OAuth flow if one is in progress.
   */
  cancel(): void {
    if (this.inFlightPoll) {
      this.inFlightPoll.abort()
      this.inFlightPoll = null
    }
  }
}
