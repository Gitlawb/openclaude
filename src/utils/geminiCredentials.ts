import { isBareMode, isEnvTruthy } from './envUtils.js'
import { getSecureStorage } from './secureStorage/index.js'

export const GEMINI_TOKEN_STORAGE_KEY = 'gemini' as const

export type GeminiCredentialBlob = {
  accessToken: string
}

export function readGeminiAccessToken(): string | undefined {
  if (isBareMode()) return undefined
  try {
    const data = getSecureStorage().read() as
      | ({ gemini?: GeminiCredentialBlob } & Record<string, unknown>)
      | null
    const token = data?.gemini?.accessToken?.trim()
    return token || undefined
  } catch {
    return undefined
  }
}

export function hydrateGeminiAccessTokenFromSecureStorage(): void {
  if (!isEnvTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return
  }
  if (process.env.GEMINI_ACCESS_TOKEN?.trim()) {
    return
  }
  if (isBareMode()) {
    return
  }
  const token = readGeminiAccessToken()
  if (token) {
    process.env.GEMINI_ACCESS_TOKEN = token
  }
}

export function saveGeminiAccessToken(token: string): {
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
  const previous = secureStorage.read() || {}
  const next = {
    ...(previous as Record<string, unknown>),
    [GEMINI_TOKEN_STORAGE_KEY]: { accessToken: trimmed },
  }
  return secureStorage.update(next as typeof previous)
}

export function clearGeminiAccessToken(): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: true }
  }
  const secureStorage = getSecureStorage()
  const previous = secureStorage.read() || {}
  const next = { ...(previous as Record<string, unknown>) }
  delete next[GEMINI_TOKEN_STORAGE_KEY]
  return secureStorage.update(next as typeof previous)
}

