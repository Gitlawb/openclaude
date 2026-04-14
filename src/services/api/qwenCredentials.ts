/**
 * Qwen OAuth credentials management using secureStorage.
 *
 * Follows the same pattern as codexCredentials.ts:
 * - Credentials stored in OS secure storage (keychain/credential manager)
 * - Auto-refresh with dedup, cooldown, and in-flight request dedup
 */

import { getSecureStorage } from '../utils/secureStorage/index.js'

// ============================================================
// Constants
// ============================================================

const QWEN_SECURE_STORAGE_KEY = 'qwen'

export interface QwenStoredCredentials {
  accessToken: string
  refreshToken: string
  resourceUrl: string
  expiryDate: number
  accountId: string
  lastRefreshAt: number
  lastRefreshFailureAt?: number
}

// ============================================================
// SecureStorage helpers
// ============================================================

function getQwenSecureStorage() {
  return getSecureStorage({ allowPlainTextFallback: false })
}

/**
 * Read Qwen credentials from secure storage.
 */
export async function readQwenCredentials(): Promise<QwenStoredCredentials | null> {
  try {
    const data = await getQwenSecureStorage().readAsync()
    return (data as Record<string, unknown>)?.[QWEN_SECURE_STORAGE_KEY] as QwenStoredCredentials | null
  } catch {
    return null
  }
}

/**
 * Save Qwen credentials to secure storage.
 * Returns true on success.
 */
export async function saveQwenCredentials(creds: QwenStoredCredentials): Promise<boolean> {
  try {
    const storage = getQwenSecureStorage()
    const previous = (await storage.readAsync()) as Record<string, unknown> | null
    const next = { ...(previous || {}), [QWEN_SECURE_STORAGE_KEY]: creds }
    const result = storage.update(next as Record<string, unknown>)
    return result.success
  } catch {
    return false
  }
}

/**
 * Check if valid Qwen credentials exist (not expired).
 */
export async function hasStoredQwenCredentials(): Promise<boolean> {
  const creds = await readQwenCredentials()
  if (!creds?.accessToken) return false
  return Date.now() < creds.expiryDate - 30_000
}

/**
 * Clear Qwen credentials from secure storage.
 */
export async function clearQwenCredentials(): Promise<boolean> {
  try {
    const storage = getQwenSecureStorage()
    const previous = (await storage.readAsync()) as Record<string, unknown> | null
    if (!previous) return true
    const { [QWEN_SECURE_STORAGE_KEY]: _, ...rest } = previous
    const result = storage.update(rest)
    return result.success
  } catch {
    return false
  }
}
