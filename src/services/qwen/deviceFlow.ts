/**
 * Qwen OAuth 2.0 Device Authorization Grant with PKCE.
 *
 * Uses the same public endpoints and client_id as the qwen-code CLI, so
 * credentials written by either tool are interchangeable (both live at
 * ~/.qwen/oauth_creds.json).
 *
 * Device code:  POST https://chat.qwen.ai/api/v1/oauth2/device/code
 * Token:        POST https://chat.qwen.ai/api/v1/oauth2/token
 * Scope:        openid profile email model.completion
 */

import { createHash, randomBytes } from 'node:crypto'

import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

export const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
export const QWEN_DEVICE_CODE_URL =
  'https://chat.qwen.ai/api/v1/oauth2/device/code'
export const QWEN_TOKEN_URL = 'https://chat.qwen.ai/api/v1/oauth2/token'
export const QWEN_OAUTH_SCOPE = 'openid profile email model.completion'
export const QWEN_DEFAULT_RESOURCE_URL = 'https://portal.qwen.ai/v1'

export class QwenDeviceFlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QwenDeviceFlowError'
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type QwenDeviceCodeResult = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
  code_verifier: string
}

export type QwenTokenResponse = {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  /** Domain (no scheme) the caller should use as the chat base host. */
  resource_url?: string
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32))
  const challenge = base64UrlEncode(
    createHash('sha256').update(verifier).digest(),
  )
  return { verifier, challenge }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function requestQwenDeviceCode(options?: {
  fetchImpl?: FetchLike
}): Promise<QwenDeviceCodeResult> {
  const fetchFn = options?.fetchImpl ?? fetch
  const { verifier, challenge } = createPkcePair()

  const res = await fetchFn(QWEN_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: QWEN_OAUTH_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new QwenDeviceFlowError(
      `Device code request failed: ${res.status} ${text}`,
    )
  }

  const data = (await res.json()) as Record<string, unknown>
  const device_code = data.device_code
  const user_code = data.user_code
  const verification_uri = data.verification_uri
  const verification_uri_complete = data.verification_uri_complete
  if (
    typeof device_code !== 'string' ||
    typeof user_code !== 'string' ||
    typeof verification_uri !== 'string'
  ) {
    throw new QwenDeviceFlowError('Malformed device code response from Qwen')
  }

  return {
    device_code,
    user_code,
    verification_uri,
    verification_uri_complete:
      typeof verification_uri_complete === 'string'
        ? verification_uri_complete
        : verification_uri,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : 1800,
    interval: typeof data.interval === 'number' ? data.interval : 5,
    code_verifier: verifier,
  }
}

export type PollQwenOptions = {
  initialInterval?: number
  timeoutSeconds?: number
  fetchImpl?: FetchLike
}

export async function pollQwenDeviceToken(
  deviceCode: string,
  codeVerifier: string,
  options?: PollQwenOptions,
): Promise<QwenTokenResponse> {
  let interval = Math.max(1, options?.initialInterval ?? 5)
  const timeoutSeconds = options?.timeoutSeconds ?? 1800
  const fetchFn = options?.fetchImpl ?? fetch
  const start = Date.now()

  while ((Date.now() - start) / 1000 < timeoutSeconds) {
    const res = await fetchFn(QWEN_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: QWEN_OAUTH_CLIENT_ID,
        device_code: deviceCode,
        code_verifier: codeVerifier,
      }),
    })

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>

    if (res.ok && typeof data.access_token === 'string') {
      return normalizeTokenResponse(data)
    }

    const err = typeof data.error === 'string' ? data.error : undefined
    if (err === 'authorization_pending') {
      await sleep(interval * 1000)
      continue
    }
    if (err === 'slow_down') {
      interval = typeof data.interval === 'number' ? data.interval : interval + 5
      await sleep(interval * 1000)
      continue
    }
    if (err === 'expired_token') {
      throw new QwenDeviceFlowError(
        'Device code expired. Start the login flow again.',
      )
    }
    if (err === 'access_denied') {
      throw new QwenDeviceFlowError('Authorization was denied or cancelled.')
    }
    const detail = err ?? `HTTP ${res.status}`
    throw new QwenDeviceFlowError(`Qwen OAuth error: ${detail}`)
  }

  throw new QwenDeviceFlowError('Timed out waiting for authorization.')
}

export async function refreshQwenToken(
  refreshToken: string,
  fetchImpl?: FetchLike,
): Promise<QwenTokenResponse> {
  const fetchFn = fetchImpl ?? fetch
  const res = await fetchFn(QWEN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: QWEN_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || typeof data.access_token !== 'string') {
    const err = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new QwenDeviceFlowError(`Token refresh failed: ${err}`)
  }
  return normalizeTokenResponse(data, refreshToken)
}

function normalizeTokenResponse(
  data: Record<string, unknown>,
  fallbackRefreshToken?: string,
): QwenTokenResponse {
  const access_token = data.access_token
  const refresh_token =
    typeof data.refresh_token === 'string' ? data.refresh_token : fallbackRefreshToken
  const expires_in = typeof data.expires_in === 'number' ? data.expires_in : 3600
  const token_type = typeof data.token_type === 'string' ? data.token_type : 'Bearer'
  const resource_url =
    typeof data.resource_url === 'string' ? data.resource_url : undefined

  if (typeof access_token !== 'string' || !refresh_token) {
    throw new QwenDeviceFlowError('Malformed Qwen token response')
  }
  return {
    access_token,
    refresh_token,
    expires_in,
    token_type,
    resource_url,
  }
}

/**
 * Normalize a `resource_url` (which Qwen returns as a bare host, sometimes
 * already including a path) into a fully-qualified chat completions base URL.
 */
export function resolveQwenBaseUrl(resourceUrl: string | undefined): string {
  const trimmed = resourceUrl?.trim()
  if (!trimmed) return QWEN_DEFAULT_RESOURCE_URL
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const cleaned = withScheme.replace(/\/+$/, '')
  if (/\/v\d+(?:beta)?$/i.test(cleaned)) return cleaned
  return `${cleaned}/v1`
}

/** Best-effort browser launch for the verification URL. */
export async function openQwenVerificationUri(uri: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      await execFileNoThrow('open', [uri], { useCwd: false, timeout: 5000 })
    } else if (process.platform === 'win32') {
      await execFileNoThrow('cmd', ['/c', 'start', '', uri], {
        useCwd: false,
        timeout: 5000,
      })
    } else {
      await execFileNoThrow('xdg-open', [uri], { useCwd: false, timeout: 5000 })
    }
  } catch {
    // User can open it manually.
  }
}
