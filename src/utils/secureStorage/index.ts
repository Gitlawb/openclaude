import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { linuxSecretStorage } from './linuxSecretStorage.js'
import { windowsCredentialStorage } from './windowsCredentialStorage.js'
import { plainTextStorage } from './plainTextStorage.js'

export interface SecureStorageData {
  codex?: {
    apiKey?: string
    accessToken: string
    refreshToken?: string
    idToken?: string
    accountId?: string
    profileId?: string
    lastRefreshAt?: number
    lastRefreshFailureAt?: number
  }
  claudeAiOauth?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scope?: string
    clientId?: string
  }
  mcpOAuth?: Record<
    string,
    {
      serverName: string
      serverUrl: string
      accessToken: string
      refreshToken?: string
      expiresAt: number
      scope?: string
      clientId?: string
      clientSecret?: string
      discoveryState?: {
        authorizationServerUrl: string
        resourceMetadataUrl?: string
      }
      stepUpScope?: string
    }
  >
  mcpOAuthClientConfig?: Record<string, { clientSecret: string }>
  mcpXaaIdp?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
  }
  mcpXaaIdpConfig?: {
    clientId?: string
    clientSecret?: string
    authorizationServerUrl?: string
  }
  trustedDeviceToken?: string
  pluginSecrets?: Record<string, Record<string, string>>
}

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}

const unavailableSecureStorage: SecureStorage = {
  name: 'unavailable-secure-storage',
  read: () => null,
  readAsync: async () => null,
  update: () => ({
    success: false,
    warning:
      'Secure storage is unavailable on this platform without plaintext fallback.',
  }),
  delete: () => true,
}

/**
 * Get the appropriate secure storage implementation for the current platform.
 * Prefers native OS vaults (Keychain, libsecret, Credential Locker) with a plaintext fallback.
 */
export function getSecureStorage(options?: {
  allowPlainTextFallback?: boolean
}): SecureStorage {
  const allowPlainTextFallback = options?.allowPlainTextFallback ?? true

  if (process.platform === 'darwin') {
    return allowPlainTextFallback
      ? createFallbackStorage(macOsKeychainStorage, plainTextStorage)
      : macOsKeychainStorage
  }

  if (process.platform === 'linux') {
    return allowPlainTextFallback
      ? createFallbackStorage(linuxSecretStorage, plainTextStorage)
      : linuxSecretStorage
  }

  if (process.platform === 'win32') {
    return allowPlainTextFallback
      ? createFallbackStorage(windowsCredentialStorage, plainTextStorage)
      : windowsCredentialStorage
  }

  return allowPlainTextFallback ? plainTextStorage : unavailableSecureStorage
}
