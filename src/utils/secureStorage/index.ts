import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { linuxSecretStorage } from './linuxSecretStorage.js'
import { windowsCredentialStorage } from './windowsCredentialStorage.js'
import { plainTextStorage } from './plainTextStorage.js'
import { withSecureStorageMutationLock } from '../secureStorageMutationLock.js'

export interface SecureStorageData {
	providerAccounts?: import('../providerAccounts/types.js').ProviderAccountsV1
	// Random app-installation identity used only to bind the native Verboo OAuth
	// session. It is not a hardware fingerprint and contains no user data.
	verbooInstallationId?: string
  verbooOauth?: {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
    scopes: string[]
    subscriptionType?: string | null
    rateLimitTier?: string | null
  }
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
  claudeNative?: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scopes: string[]
    accountId: string
    email?: string
    organizationId?: string
    riskAcceptance: {
      version: number
      acceptedAt: string
      accountId: string
    }
    lastRefreshAt?: number
    lastRefreshFailureAt?: number
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
  trustedDeviceToken?: string
  pluginSecrets?: Record<string, Record<string, string>>
}

export type SecureStorageReadResult =
  | { kind: 'ok'; data: SecureStorageData }
  | { kind: 'missing' }
  | { kind: 'error'; warning?: string }

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  /** Optional classified read used by stateful stores that must fail closed. */
  readResult?(): SecureStorageReadResult
  readAsync(): Promise<SecureStorageData | null>
  readResultAsync?(): Promise<SecureStorageReadResult>
  update(
    data: SecureStorageData,
    options?: {
      preserveProviderAccounts?: boolean
      lockHeld?: boolean
      /** Replace a record that is known to contain malformed JSON. */
      replaceCorrupt?: boolean
    },
  ): { success: boolean; warning?: string }
  delete(): boolean
}

const unavailableSecureStorage: SecureStorage = {
  name: 'unavailable-secure-storage',
  read: () => null,
  readResult: () => ({ kind: 'error', warning: 'Secure storage is unavailable.' }),
  readAsync: async () => null,
  readResultAsync: async () => ({ kind: 'error', warning: 'Secure storage is unavailable.' }),
  update: () => ({
    success: false,
    warning:
      'Secure storage is unavailable on this platform without plaintext fallback.',
  }),
  delete: () => true,
}

/**
 * Get the appropriate secure storage implementation for the current platform.
 * Prefers native OS secure storage (Keychain, libsecret, or Windows DPAPI
 * protected per-user storage) with an optional plaintext fallback.
 */
export function getSecureStorage(options?: {
  allowPlainTextFallback?: boolean
}): SecureStorage {
  const allowPlainTextFallback = options?.allowPlainTextFallback ?? true

  let selected: SecureStorage
  if (process.platform === 'darwin') {
    selected = allowPlainTextFallback
      ? createFallbackStorage(macOsKeychainStorage, plainTextStorage)
      : macOsKeychainStorage
  } else if (process.platform === 'linux') {
    selected = allowPlainTextFallback
      ? createFallbackStorage(linuxSecretStorage, plainTextStorage)
      : linuxSecretStorage
  } else if (process.platform === 'win32') {
    selected = allowPlainTextFallback
      ? createFallbackStorage(windowsCredentialStorage, plainTextStorage)
      : windowsCredentialStorage
  } else {
    selected = allowPlainTextFallback ? plainTextStorage : unavailableSecureStorage
  }

  return preserveProviderAccountsOnSharedWrites(selected)
}

/**
 * Provider accounts live in the same native record as legacy credentials.
 * Writers that update another field must re-read the current provider
 * collection under the shared lock so an older snapshot cannot erase a newly
 * added account. Provider-account mutations opt out and provide the complete
 * replacement while already holding that lock.
 */
function preserveProviderAccountsOnSharedWrites(storage: SecureStorage): SecureStorage {
  return {
    ...storage,
    update(data, options = {}) {
      const write = () => {
        let next = data
        if (options.preserveProviderAccounts !== false) {
          const current = storage.readResult?.()
          if (
            current?.kind === 'error' &&
            !(options.replaceCorrupt &&
              current.warning?.includes('returned malformed JSON.'))
          ) {
            return { success: false, warning: current.warning ?? 'Secure storage read failed.' }
          }
          if (current?.kind === 'ok' && current.data.providerAccounts) {
            next = { ...data, providerAccounts: current.data.providerAccounts }
          }
        }
        return storage.update(next)
      }
      return options.lockHeld ? write() : withSecureStorageMutationLock(write)
    },
  }
}
