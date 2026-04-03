import { isBareMode, isEnvTruthy } from './envUtils.js'
import { getSecureStorage } from './secureStorage/index.js'
import { exchangeForCopilotToken } from '../services/github/deviceFlow.js'

/** JSON key in the shared OpenClaude secure storage blob. */
export const GITHUB_MODELS_STORAGE_KEY = 'githubModels' as const

export type GithubModelsCredentialBlob = {
  accessToken: string
  oauthAccessToken?: string
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
  if (isBareMode()) return undefined
  try {
    const data = getSecureStorage().read() as
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
    return
  }
  if (process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim()) {
    return
  }
  if (isBareMode()) {
    return
  }
  const t = readGithubModelsToken()
  if (t) {
    process.env.GITHUB_TOKEN = t
  }
}

/**
 * Startup auto-refresh for GitHub Models mode.
 *
 * If a stored Copilot token is expired/invalid and an OAuth token is present,
 * exchange the OAuth token for a fresh Copilot token and persist it.
 */
export async function refreshGithubModelsTokenIfNeeded(): Promise<boolean> {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    return false
  }
  if (isBareMode()) {
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

    const refreshed = await exchangeForCopilotToken(oauthToken)
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
