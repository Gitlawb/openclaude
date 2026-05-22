import { logForDebugging } from './debug.js'
import {
  isOneclawConfigured,
  loadOneclawConfig,
  getOneclawAgentApiKey,
} from './oneclaw.js'
import { getOneclawAgentClient } from './oneclawClient.js'
import { isEnvTruthy } from './envUtils.js'

const ANTHROPIC_AUDIENCE = 'https://api.anthropic.com'
const ANTHROPIC_TOKEN_EXCHANGE_URL = 'https://api.anthropic.com/v1/oauth/token'

interface OidcTokenCache {
  anthropicToken: string
  expiresAt: number
}

let tokenCache: OidcTokenCache | null = null

export function isOidcFederationEnabled(): boolean {
  if (isEnvTruthy(process.env.ONECLAW_OIDC_DISABLED)) return false
  if (isEnvTruthy(process.env.ONECLAW_OIDC_ENABLED)) return true

  const config = loadOneclawConfig()
  return config?.oidcFederationEnabled === true
}

export function clearOidcTokenCache(): void {
  tokenCache = null
}

async function getFederatedJwt(): Promise<string | null> {
  const client = getOneclawAgentClient()
  if (!client) return null

  try {
    const res = await client.auth.exchangeFederatedToken({
      audience: ANTHROPIC_AUDIENCE,
    })
    if (res.error) {
      logForDebugging(`[OIDC] federated token error: ${res.error.message}`)
      return null
    }
    return res.data?.access_token ?? null
  } catch (err) {
    logForDebugging(`[OIDC] federated token exchange failed: ${err}`)
    return null
  }
}

async function exchangeAtAnthropic(
  federatedJwt: string,
): Promise<{ token: string; expiresIn: number } | null> {
  try {
    const resp = await fetch(ANTHROPIC_TOKEN_EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: federatedJwt,
      }).toString(),
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      logForDebugging(`[OIDC] Anthropic token exchange ${resp.status}: ${body}`)
      return null
    }

    const data = (await resp.json()) as {
      access_token?: string
      expires_in?: number
    }
    if (!data.access_token) return null

    return { token: data.access_token, expiresIn: data.expires_in ?? 900 }
  } catch (err) {
    logForDebugging(`[OIDC] Anthropic token exchange error: ${err}`)
    return null
  }
}

export async function resolveAnthropicOidcToken(): Promise<string | null> {
  if (!isOidcFederationEnabled()) return null
  if (!isOneclawConfigured()) return null
  if (!getOneclawAgentApiKey()) return null

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.anthropicToken
  }

  logForDebugging('[OIDC] exchanging 1claw agent key for Anthropic WIF token')

  const jwt = await getFederatedJwt()
  if (!jwt) return null

  const result = await exchangeAtAnthropic(jwt)
  if (!result) return null

  tokenCache = {
    anthropicToken: result.token,
    expiresAt: Date.now() + result.expiresIn * 1000,
  }

  logForDebugging(`[OIDC] obtained Anthropic token, expires in ${result.expiresIn}s`)
  return result.token
}
