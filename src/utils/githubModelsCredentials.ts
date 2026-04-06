import { isBareMode, isEnvTruthy } from './envUtils.js'
import { getSecureStorage } from './secureStorage/index.js'

/** JSON key in the shared OpenClaude secure storage blob. */
export const GITHUB_MODELS_STORAGE_KEY = 'githubModels' as const
export const GITHUB_MODELS_HYDRATED_ENV_MARKER =
  'CLAUDE_CODE_GITHUB_TOKEN_HYDRATED' as const

export type GithubModelsCredentialBlob = {
  accessToken: string
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
  if (process.env.GH_TOKEN?.trim()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (process.env.GITHUB_TOKEN?.trim()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  if (isBareMode()) {
    delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
    return
  }
  const t = readGithubModelsToken()
  if (t) {
    process.env.GITHUB_TOKEN = t
    process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER] = '1'
    return
  }
  delete process.env[GITHUB_MODELS_HYDRATED_ENV_MARKER]
}

export function saveGithubModelsToken(token: string): {
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
  const merged = {
    ...(prev as Record<string, unknown>),
    [GITHUB_MODELS_STORAGE_KEY]: { accessToken: trimmed },
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
