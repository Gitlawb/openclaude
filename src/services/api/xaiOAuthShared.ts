/**
 * xAI OAuth shared constants and helpers.
 *
 * Mirrors the OAuth flow shipped by openclaw (`extensions/xai/xai-oauth.ts`),
 * which is the canonical reference for the xAI shared OAuth client. The
 * client_id is a public, xAI-issued credential intended for third-party CLI
 * use; xAI may label the consent app "Grok Build" because it is shared.
 *
 * Inference works the same as an API key: the access token is sent as a
 * Bearer to `https://api.x.ai/v1`, so no proxy is involved.
 */

import { createCombinedAbortSignal } from '../../utils/combinedAbortSignal.js'

export const XAI_OAUTH_ISSUER = 'https://auth.x.ai'
export const XAI_OAUTH_DISCOVERY_URL = `${XAI_OAUTH_ISSUER}/.well-known/openid-configuration`
export const DEFAULT_XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const DEFAULT_XAI_OAUTH_CALLBACK_PORT = 56121
export const DEFAULT_XAI_OAUTH_CALLBACK_HOST = '127.0.0.1'
export const XAI_OAUTH_CALLBACK_PATH = '/callback'
export const XAI_OAUTH_SCOPE =
  'openid profile email offline_access grok-cli:access api:access'
export const XAI_OAUTH_REFERRER = 'openclaude'
export const XAI_DEVICE_CODE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:device_code'

const ALLOWED_XAI_OAUTH_CALLBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
])

const TRUSTED_XAI_OAUTH_HOSTS = new Set(['x.ai'])

export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getXaiOAuthClientId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    asTrimmedString(env.XAI_OAUTH_CLIENT_ID) ?? DEFAULT_XAI_OAUTH_CLIENT_ID
  )
}

export function getXaiOAuthCallbackPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = asTrimmedString(env.XAI_OAUTH_CALLBACK_PORT)
  if (!raw) return DEFAULT_XAI_OAUTH_CALLBACK_PORT
  const parsed = Number.parseInt(raw, 10)
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }
  return DEFAULT_XAI_OAUTH_CALLBACK_PORT
}

export function getXaiOAuthCallbackHost(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = asTrimmedString(env.XAI_OAUTH_CALLBACK_HOST)
  if (raw && ALLOWED_XAI_OAUTH_CALLBACK_HOSTS.has(raw)) return raw
  return DEFAULT_XAI_OAUTH_CALLBACK_HOST
}

export function getXaiOAuthRedirectUri(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const host = getXaiOAuthCallbackHost(env)
  const port = getXaiOAuthCallbackPort(env)
  return `http://${host}:${port}${XAI_OAUTH_CALLBACK_PATH}`
}

export function isTrustedXaiOAuthEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') return false
    const hostname = url.hostname.toLowerCase()
    if (TRUSTED_XAI_OAUTH_HOSTS.has(hostname)) return true
    return [...TRUSTED_XAI_OAUTH_HOSTS].some(h => hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

export function requireTrustedXaiOAuthEndpoint(
  endpoint: string,
  label: string,
): string {
  if (!isTrustedXaiOAuthEndpoint(endpoint)) {
    throw new Error(`xAI OAuth discovery returned untrusted ${label}`)
  }
  return endpoint
}

export function decodeJwtPayload(
  token: string | undefined,
): Record<string, unknown> | undefined {
  if (!token) return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = Buffer.from(padded, 'base64').toString('utf8')
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function deriveExpiresMsFromJwt(
  token: string | undefined,
): number | undefined {
  const payload = decodeJwtPayload(token)
  if (!payload) return undefined
  const exp = payload.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) {
    return undefined
  }
  return exp * 1000
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    ch =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch] ?? ch,
  )
}

export type XaiOAuthDiscovery = {
  authorizationEndpoint: string
  tokenEndpoint: string
  deviceAuthorizationEndpoint?: string
}

export async function fetchXaiOAuthDiscovery(options?: {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<XaiOAuthDiscovery> {
  const fetchImpl = options?.fetchImpl ?? fetch
  // Use the cleanup-safe helper instead of `AbortSignal.timeout(...)` so the
  // underlying timer is cleared on success — raw timeout signals leak
  // timers in Bun and are forbidden by the repo guard.
  const { signal, cleanup } = createCombinedAbortSignal(options?.signal, {
    timeoutMs: options?.timeoutMs ?? 15_000,
  })
  let response: Response
  try {
    response = await fetchImpl(XAI_OAUTH_DISCOVERY_URL, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } finally {
    cleanup()
  }
  if (!response.ok) {
    throw new Error(
      `xAI OAuth discovery failed with status ${response.status}`,
    )
  }
  const json = (await response.json()) as Record<string, unknown>
  const authorizationEndpoint = json.authorization_endpoint
  const tokenEndpoint = json.token_endpoint
  const deviceAuthorizationEndpoint = json.device_authorization_endpoint
  if (
    typeof authorizationEndpoint !== 'string' ||
    typeof tokenEndpoint !== 'string'
  ) {
    throw new Error('xAI OAuth discovery response is missing endpoints')
  }
  return {
    authorizationEndpoint: requireTrustedXaiOAuthEndpoint(
      authorizationEndpoint,
      'authorization endpoint',
    ),
    tokenEndpoint: requireTrustedXaiOAuthEndpoint(
      tokenEndpoint,
      'token endpoint',
    ),
    ...(typeof deviceAuthorizationEndpoint === 'string'
      ? {
          deviceAuthorizationEndpoint: requireTrustedXaiOAuthEndpoint(
            deviceAuthorizationEndpoint,
            'device authorization endpoint',
          ),
        }
      : {}),
  }
}
