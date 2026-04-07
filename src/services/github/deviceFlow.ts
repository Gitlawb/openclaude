/**
 * GitHub OAuth device flow for CLI login (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
 */

import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

export const DEFAULT_GITHUB_DEVICE_FLOW_CLIENT_ID = 'Ov23liXjWSSui6QIahPl'

export const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
export const GITHUB_DEVICE_ACCESS_TOKEN_URL =
  'https://github.com/login/oauth/access_token'

// OAuth app device flow does not accept the GitHub Models permission token
// scope (models:read). Use an OAuth-safe default.
const OAUTH_SAFE_GITHUB_DEVICE_SCOPE = 'read:user'
export const DEFAULT_GITHUB_DEVICE_SCOPE = OAUTH_SAFE_GITHUB_DEVICE_SCOPE

export class GitHubDeviceFlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubDeviceFlowError'
  }
}

export type DeviceCodeResult = {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export function getGithubDeviceFlowClientId(): string {
  return (
    process.env.GITHUB_DEVICE_FLOW_CLIENT_ID?.trim() ||
    DEFAULT_GITHUB_DEVICE_FLOW_CLIENT_ID
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function requestDeviceCode(options?: {
  clientId?: string
  scope?: string
  fetchImpl?: typeof fetch
}): Promise<DeviceCodeResult> {
  const clientId = options?.clientId ?? getGithubDeviceFlowClientId()
  if (!clientId) {
    throw new GitHubDeviceFlowError(
      'No OAuth client ID: set GITHUB_DEVICE_FLOW_CLIENT_ID or paste a PAT instead.',
    )
  }
  const fetchFn = options?.fetchImpl ?? fetch
  const requestedScope =
    options?.scope?.trim() || DEFAULT_GITHUB_DEVICE_SCOPE
  const scopesToTry =
    requestedScope === OAUTH_SAFE_GITHUB_DEVICE_SCOPE
      ? [requestedScope]
      : [requestedScope, OAUTH_SAFE_GITHUB_DEVICE_SCOPE]

  let lastError = 'Device code request failed.'

  for (const scope of scopesToTry) {
    const res = await fetchFn(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        scope,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      lastError = `Device code request failed: ${res.status} ${text}`
      const isInvalidScope = /invalid_scope/i.test(text)
      const canRetryWithFallback =
        scope !== OAUTH_SAFE_GITHUB_DEVICE_SCOPE && isInvalidScope
      if (canRetryWithFallback) {
        continue
      }
      throw new GitHubDeviceFlowError(lastError)
    }

    const data = (await res.json()) as Record<string, unknown>
    const device_code = data.device_code
    const user_code = data.user_code
    const verification_uri = data.verification_uri
    if (
      typeof device_code !== 'string' ||
      typeof user_code !== 'string' ||
      typeof verification_uri !== 'string'
    ) {
      throw new GitHubDeviceFlowError(
        'Malformed device code response from GitHub',
      )
    }

    return {
      device_code,
      user_code,
      verification_uri,
      expires_in: typeof data.expires_in === 'number' ? data.expires_in : 900,
      interval: typeof data.interval === 'number' ? data.interval : 5,
    }
  }

  throw new GitHubDeviceFlowError(lastError)
}

export type PollOptions = {
  clientId?: string
  initialInterval?: number
  timeoutSeconds?: number
  fetchImpl?: typeof fetch
}

export async function pollAccessToken(
  deviceCode: string,
  options?: PollOptions,
): Promise<string> {
  const clientId = options?.clientId ?? getGithubDeviceFlowClientId()
  if (!clientId) {
    throw new GitHubDeviceFlowError('client_id required for polling')
  }
  let interval = Math.max(1, options?.initialInterval ?? 5)
  const timeoutSeconds = options?.timeoutSeconds ?? 900
  const fetchFn = options?.fetchImpl ?? fetch
  const start = Date.now()

  while ((Date.now() - start) / 1000 < timeoutSeconds) {
    const res = await fetchFn(GITHUB_DEVICE_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new GitHubDeviceFlowError(
        `Token request failed: ${res.status} ${text}`,
      )
    }
    const data = (await res.json()) as Record<string, unknown>
    const err = data.error as string | undefined
    if (err == null) {
      const token = data.access_token
      if (typeof token === 'string' && token) {
        return token
      }
      throw new GitHubDeviceFlowError('No access_token in response')
    }
    if (err === 'authorization_pending') {
      await sleep(interval * 1000)
      continue
    }
    if (err === 'slow_down') {
      interval =
        typeof data.interval === 'number' ? data.interval : interval + 5
      await sleep(interval * 1000)
      continue
    }
    if (err === 'expired_token') {
      throw new GitHubDeviceFlowError(
        'Device code expired. Start the login flow again.',
      )
    }
    if (err === 'access_denied') {
      throw new GitHubDeviceFlowError('Authorization was denied or cancelled.')
    }
    throw new GitHubDeviceFlowError(`GitHub OAuth error: ${err}`)
  }
  throw new GitHubDeviceFlowError('Timed out waiting for authorization.')
}

/**
 * Best-effort open browser / OS handler for the verification URL.
 */
export async function openVerificationUri(uri: string): Promise<void> {
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
    // User can open the URL manually
  }
}
