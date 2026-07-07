import { isBareMode, isEnvTruthy } from './envUtils.js'
import { getSecureStorage } from './secureStorage/index.js'
import { exchangeForCopilotToken } from '../services/github/deviceFlow.js'
import { logForDebugging } from './debug.js'

/** JSON key in the shared OpenClaude secure storage blob. */
export const GITHUB_MODELS_STORAGE_KEY = 'githubModels' as const
export const GITHUB_MODELS_HYDRATED_ENV_MARKER =
  'CLAUDE_CODE_GITHUB_TOKEN_HYDRATED' as const

export type GithubModelsCredentialBlob = {
  accessToken: string
  oauthAccessToken?: string
  credentialType?: 'copilot_token' | 'copilot_key'
}

type GithubTokenStatus = 'valid' | 'expired' | 'invalid_format'

function checkGithubTokenStatus(token: string): GithubTokenStatus {
  const expMatch = token.match(/exp=(\d+)/)
  if (expMatch) {
    const expSeconds = Number(expMatch[1])
    if (!Number.isNaN(expSeconds)) {
      return Date.now() >= expSeconds * 1000 ? 'expired' : 'valid'
    }
  }

  const parts = token.split('.')
  const looksLikeJwt =
    parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))
  if (looksLikeJwt) {
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
      const json = Buffer.from(padded, 'base64').toString('utf8')
      const parsed = JSON.parse(json)
      if (parsed && typeof parsed === 'object' && parsed.exp) {
        return Date.now() >= (parsed.exp as number) * 1000 ? 'expired' : 'valid'
      }
    } catch {
      return 'invalid_format'
    }
  }

  return 'invalid_format'
}

export function readGithubModelsToken(): string | undefined {
  return readGithubModelsCredentialBlob()?.accessToken
}

function readGithubModelsCredentialBlob(): GithubModelsCredentialBlob | undefined {
  if (isBareMode()) return undefined
  try {
    const data = getSecureStorage().read() as
      | ({ githubModels?: GithubModelsCredentialBlob } & Record<string, unknown>)
      | null
    const blob = data?.githubModels
    const accessToken = blob?.accessToken?.trim()
    if (!accessToken) return undefined
    return {
      ...blob,
      accessToken,
      oauthAccessToken: blob?.oauthAccessToken?.trim() || undefined,
    }
  } catch {
    return undefined
  }
}

export async function readGithubModelsTokenAsync(): Promise<string | undefined> {
  if (isBareMode()) return undefined
  try {
    const data = (await getSecureStorage().readAsync()) as
      | ({ githubModels?: GithubModelsCredentialBlob } & Record<string, unknown>)
      | null
    const t = data?.githubModels?.accessToken?.trim()
    return t || undefined
  } catch {
    return undefined
  }
}

/**
 * If GitHub Models mode is on and no token is in the environment, copy the
 * stored token into process.env so the OpenAI shim and validation see it.
 */
export function hydrateGithubModelsTokenFromSecureStorage(): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (process.env.GITHUB_COPILOT_KEY?.trim()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (isBareMode()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  const stored = readGithubModelsCredentialBlob()
  if (stored?.credentialType === 'copilot_key') {
    process.env.GITHUB_COPILOT_KEY = stored.accessToken
    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    return
  }
  if (process.env.GH_TOKEN?.trim()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (process.env.GITHUB_TOKEN?.trim()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (stored?.accessToken) {
    process.env.GITHUB_TOKEN = stored.accessToken
    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    return
  }
  delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
}

/**
 * Startup auto-refresh for GitHub Models mode.
 *
 * If a stored Copilot token is expired/invalid and an OAuth token is present,
 * exchange the OAuth token for a fresh Copilot token and persist it.
 *
 * For GHE instances, the token exchange is routed through the GHE endpoint.
 */
export async function refreshGithubModelsTokenIfNeeded(): Promise<boolean> {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    return false
  }
  if (isBareMode()) {
    return false
  }

  // GITHUB_COPILOT_KEY is a direct API key, no refresh needed
  if (process.env.GITHUB_COPILOT_KEY?.trim()) {
    return false
  }

  try {
    const secureStorage = getSecureStorage()
    const data = secureStorage.read() as
      | ({ githubModels?: GithubModelsCredentialBlob } & Record<string, unknown>)
      | null
    const blob = data?.githubModels
    const accessToken = blob?.accessToken?.trim() || ''
    const oauthToken = blob?.oauthAccessToken?.trim() || ''

    if (blob?.credentialType === 'copilot_key') {
      if (accessToken && !process.env.GITHUB_COPILOT_KEY?.trim()) {
        process.env.GITHUB_COPILOT_KEY = accessToken
      }
      return false
    }

    if (!accessToken && !oauthToken) {
      return false
    }

    const status = accessToken ? checkGithubTokenStatus(accessToken) : 'expired'
    if (status === 'valid') {
      if (!process.env.GITHUB_TOKEN?.trim() && !process.env.GH_TOKEN?.trim()) {
        process.env.GITHUB_TOKEN = accessToken
      }
      return false
    }

    if (!oauthToken) {
      return false
    }

    // Get GHE URL for token exchange if in enterprise mode
    const gheUrl = process.env.GITHUB_ENTERPRISE_URL?.trim() || undefined

    const refreshed = await exchangeForCopilotToken(oauthToken, undefined, gheUrl)
    const saved = saveGithubModelsToken(refreshed.token, oauthToken)
    if (!saved.success) {
      return false
    }

    process.env.GITHUB_TOKEN = refreshed.token
    return true
  } catch {
    return false
  }
}

export function saveGithubModelsToken(
  token: string,
  oauthToken?: string,
  options?: { credentialType?: GithubModelsCredentialBlob['credentialType'] },
): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: false, warning: 'Bare mode: secure storage is disabled.' }
  }
  const trimmed = token.trim()
  if (!trimmed) {
    return { success: false, warning: 'Token is empty.' }
  }
  const secureStorage = getSecureStorage()
  const prev = secureStorage.read() || {}
  const prevGithubModels = (prev as Record<string, unknown>)[
    GITHUB_MODELS_STORAGE_KEY
  ] as GithubModelsCredentialBlob | undefined
  const oauthTrimmed = oauthToken?.trim()
  const mergedBlob: GithubModelsCredentialBlob = {
    accessToken: trimmed,
    credentialType: options?.credentialType ?? 'copilot_token',
  }
  if (oauthTrimmed) {
    mergedBlob.oauthAccessToken = oauthTrimmed
  } else if (prevGithubModels?.oauthAccessToken?.trim()) {
    mergedBlob.oauthAccessToken = prevGithubModels.oauthAccessToken.trim()
  }
  const merged = {
    ...(prev as Record<string, unknown>),
    [GITHUB_MODELS_STORAGE_KEY]: mergedBlob,
  }
  return secureStorage.update(merged as typeof prev)
}

/**
 * Force-refresh the Copilot token on 401.
 *
 * Only refreshes when the failing credential matches the stored Copilot
 * token — silently skipping when a provider override, route credential,
 * or custom auth header is in use, preventing credential substitution.
 *
 * Returns true if the refresh succeeded.
 */
export async function refreshCopilotTokenOn401(): Promise<boolean> {
  if (isBareMode()) return false

  // Direct API key users cannot refresh — they need to update the key manually
  if (process.env.GITHUB_COPILOT_KEY?.trim()) return false

  try {
    const blob = readGithubModelsCredentialBlob()
    if (!blob) return false
    if (blob.credentialType === 'copilot_key') return false

    // Only refresh when the failing credential IS the stored Copilot token.
    // A provider override, route credential, or manually-set GITHUB_TOKEN
    // will not match, preventing silent credential substitution.
    const currentCredential = process.env.OPENAI_API_KEY?.trim()
    if (!currentCredential || currentCredential !== blob.accessToken) return false

    const oauthToken = blob.oauthAccessToken
    if (!oauthToken) return false

    const gheUrl = process.env.GITHUB_ENTERPRISE_URL?.trim() || undefined
    const refreshed = await exchangeForCopilotToken(oauthToken, undefined, gheUrl)
    const saved = saveGithubModelsToken(refreshed.token, oauthToken)
    if (!saved.success) return false

    process.env.GITHUB_TOKEN = refreshed.token
    process.env.OPENAI_API_KEY = refreshed.token
    return true
  } catch (error) {
    logForDebugging(
      `[refreshCopilotTokenOn401] failed: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    return false
  }
}

export function clearGithubModelsToken(): { success: boolean; warning?: string } {
  if (isBareMode()) {
    return { success: true }
  }
  const secureStorage = getSecureStorage()
  const prev = secureStorage.read() || {}
  const next = { ...(prev as Record<string, unknown>) }
  delete next[GITHUB_MODELS_STORAGE_KEY]
  return secureStorage.update(next as typeof prev)
}
