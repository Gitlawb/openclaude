import { isBareMode } from './envUtils.js'
import { createCombinedAbortSignal } from './combinedAbortSignal.js'
import {
  getSecureStorage,
  type SecureStorageData,
} from './secureStorage/index.js'
import { plainTextStorage } from './secureStorage/plainTextStorage.js'
import {
  asTrimmedString,
  CODEX_REFRESH_URL,
  exchangeCodexIdTokenForApiKey,
  getCodexOAuthClientId,
  parseChatgptAccountId,
  decodeJwtPayload,
} from '../services/api/codexOAuthShared.js'

export const CODEX_STORAGE_KEY = 'codex' as const
const CODEX_TOKEN_REFRESH_SKEW_MS = 60_000
const CODEX_TOKEN_REFRESH_RETRY_COOLDOWN_MS = 60_000
const CODEX_FALLBACK_NATIVE_DELETE_FAILED_WARNING =
  'Codex credentials were written to plaintext fallback, but stale native secure storage could not be removed.'
const CODEX_PLAINTEXT_CLEANUP_FAILED_WARNING =
  'Codex credentials were saved, but stale plaintext fallback credentials could not be removed.'

export type CodexCredentialBlob = {
  apiKey?: string
  accessToken: string
  refreshToken?: string
  idToken?: string
  accountId?: string
  profileId?: string
  lastRefreshAt?: number
  lastRefreshFailureAt?: number
}

type CodexTokenRefreshResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

let inFlightCodexRefresh:
  | Promise<{
      refreshed: boolean
      credentials?: CodexCredentialBlob
    }>
  | null = null
let inMemoryLastRefreshFailureAt: number | null = null

function getCodexPrimarySecureStorage() {
  return getSecureStorage({ allowPlainTextFallback: false })
}

function parseJwtExpiryMs(token: string | undefined): number | undefined {
  if (!token) return undefined
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    return exp * 1000
  }
  return undefined
}

function normalizeCodexCredentialBlob(
  value: unknown,
): CodexCredentialBlob | undefined {
  if (!value || typeof value !== 'object') return undefined

  const record = value as Record<string, unknown>
  const apiKey = asTrimmedString(record.apiKey)
  const accessToken = asTrimmedString(record.accessToken)
  if (!accessToken) return undefined

  const refreshToken = asTrimmedString(record.refreshToken)
  const idToken = asTrimmedString(record.idToken)
  const accountId =
    asTrimmedString(record.accountId) ??
    parseChatgptAccountId(idToken) ??
    parseChatgptAccountId(accessToken)
  const profileId = asTrimmedString(record.profileId)

  const lastRefreshAt =
    typeof record.lastRefreshAt === 'number' &&
    Number.isFinite(record.lastRefreshAt)
      ? record.lastRefreshAt
      : undefined
  const lastRefreshFailureAt =
    typeof record.lastRefreshFailureAt === 'number' &&
    Number.isFinite(record.lastRefreshFailureAt)
      ? record.lastRefreshFailureAt
      : undefined

  return {
    apiKey,
    accessToken,
    refreshToken,
    idToken,
    accountId,
    profileId,
    lastRefreshAt,
    lastRefreshFailureAt,
  }
}

function getRecord(data: SecureStorageData | null | undefined): Record<
  string,
  unknown
> {
  return data && typeof data === 'object'
    ? (data as Record<string, unknown>)
    : {}
}

function hasStoredCodexRecord(
  data: SecureStorageData | null | undefined,
): boolean {
  return Object.prototype.hasOwnProperty.call(getRecord(data), CODEX_STORAGE_KEY)
}

function hasNonCodexStorageFields(
  data: SecureStorageData | null | undefined,
): boolean {
  return Object.keys(getRecord(data)).some(key => key !== CODEX_STORAGE_KEY)
}

function readCodexFromPlainTextStorage(): CodexCredentialBlob | undefined {
  try {
    const data = plainTextStorage.read()
    return normalizeCodexCredentialBlob(data?.[CODEX_STORAGE_KEY])
  } catch {
    return undefined
  }
}

async function readCodexFromPlainTextStorageAsync(): Promise<
  CodexCredentialBlob | undefined
> {
  try {
    const data = await plainTextStorage.readAsync()
    return normalizeCodexCredentialBlob(data?.[CODEX_STORAGE_KEY])
  } catch {
    return undefined
  }
}

// Do not use the generic secure-storage fallback for Codex writes. Its update()
// path receives the whole storage document, so a native-write failure can copy
// unrelated native-only secrets into plaintext.
function writeCodexToPlainTextStorage(
  codex: CodexCredentialBlob,
): { success: boolean; warning?: string } {
  try {
    const previous = plainTextStorage.read() || {}
    const next = {
      ...getRecord(previous),
      [CODEX_STORAGE_KEY]: codex,
    }
    return plainTextStorage.update(next as SecureStorageData)
  } catch {
    return { success: false }
  }
}

function removeCodexFromPlainTextStorage(): {
  success: boolean
  warning?: string
} {
  try {
    const previous = plainTextStorage.read()
    if (!hasStoredCodexRecord(previous)) {
      return { success: true }
    }

    const next = { ...getRecord(previous) }
    delete next[CODEX_STORAGE_KEY]

    if (Object.keys(next).length === 0) {
      return plainTextStorage.delete()
        ? { success: true }
        : {
            success: false,
            warning: CODEX_PLAINTEXT_CLEANUP_FAILED_WARNING,
          }
    }

    const result = plainTextStorage.update(next as SecureStorageData)
    return result.success
      ? { success: true }
      : {
          success: false,
          warning:
            result.warning ?? CODEX_PLAINTEXT_CLEANUP_FAILED_WARNING,
        }
  } catch {
    return {
      success: false,
      warning: CODEX_PLAINTEXT_CLEANUP_FAILED_WARNING,
    }
  }
}

function shouldRefreshCodexToken(blob: CodexCredentialBlob): boolean {
  const expiresAt =
    parseJwtExpiryMs(blob.accessToken) ?? parseJwtExpiryMs(blob.idToken)
  if (expiresAt === undefined) {
    return false
  }
  return expiresAt <= Date.now() + CODEX_TOKEN_REFRESH_SKEW_MS
}

function isWithinRefreshFailureCooldown(
  blob: CodexCredentialBlob,
  now = Date.now(),
): boolean {
  const lastRefreshFailureAt = Math.max(
    blob.lastRefreshFailureAt ?? 0,
    inMemoryLastRefreshFailureAt ?? 0,
  )

  if (!lastRefreshFailureAt) {
    return false
  }

  return (
    now - lastRefreshFailureAt < CODEX_TOKEN_REFRESH_RETRY_COOLDOWN_MS
  )
}

function getRefreshErrorMessage(
  status: number,
  bodyText: string,
): string {
  if (!bodyText.trim()) {
    return `Codex token refresh failed with status ${status}.`
  }

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    const nestedError =
      parsed.error && typeof parsed.error === 'object'
        ? (parsed.error as Record<string, unknown>)
        : undefined
    const code = asTrimmedString(nestedError?.code ?? parsed.code)
    const message =
      asTrimmedString(nestedError?.message ?? parsed.error_description) ??
      bodyText.trim()
    return code
      ? `Codex token refresh failed (${code}): ${message}`
      : `Codex token refresh failed with status ${status}: ${message}`
  } catch {
    return `Codex token refresh failed with status ${status}: ${bodyText.trim()}`
  }
}

export function readCodexCredentials(): CodexCredentialBlob | undefined {
  if (isBareMode()) return undefined

  try {
    const data = getCodexPrimarySecureStorage().read()
    const primaryCodex = normalizeCodexCredentialBlob(data?.codex)
    if (primaryCodex) return primaryCodex
  } catch {
    // Fall through to the Codex-only plaintext fallback.
  }

  return readCodexFromPlainTextStorage()
}

export async function readCodexCredentialsAsync(): Promise<
  CodexCredentialBlob | undefined
> {
  if (isBareMode()) return undefined

  try {
    const data = await getCodexPrimarySecureStorage().readAsync()
    const primaryCodex = normalizeCodexCredentialBlob(data?.codex)
    if (primaryCodex) return primaryCodex
  } catch {
    // Fall through to the Codex-only plaintext fallback.
  }

  return readCodexFromPlainTextStorageAsync()
}

export function isCodexRefreshFailureCoolingDown(
  blob: Pick<CodexCredentialBlob, 'lastRefreshFailureAt'>,
  now = Date.now(),
): boolean {
  return isWithinRefreshFailureCooldown(
    blob as CodexCredentialBlob,
    now,
  )
}

export function saveCodexCredentials(
  credentials: CodexCredentialBlob,
): { success: boolean; warning?: string } {
  if (isBareMode()) {
    return { success: false, warning: 'Bare mode: secure storage is disabled.' }
  }

  const normalized = normalizeCodexCredentialBlob(credentials)
  if (!normalized) {
    return { success: false, warning: 'Codex credentials are incomplete.' }
  }

  const secureStorage = getCodexPrimarySecureStorage()
  const previous = secureStorage.read()
  const previousNativeCodex = normalizeCodexCredentialBlob(
    previous?.[CODEX_STORAGE_KEY],
  )
  const previousCodex = previousNativeCodex ?? readCodexFromPlainTextStorage()
  const next = {
    ...getRecord(previous),
    [CODEX_STORAGE_KEY]: {
      ...normalized,
      profileId: normalized.profileId ?? previousCodex?.profileId,
      lastRefreshAt: normalized.lastRefreshAt ?? Date.now(),
    },
  }
  const result = secureStorage.update(next as SecureStorageData)
  if (result.success) {
    const storedCodex = normalizeCodexCredentialBlob(next[CODEX_STORAGE_KEY])
    inMemoryLastRefreshFailureAt = storedCodex?.lastRefreshFailureAt ?? null
    const cleanupResult = removeCodexFromPlainTextStorage()
    if (!cleanupResult.success) {
      return {
        success: true,
        warning:
          cleanupResult.warning ?? CODEX_PLAINTEXT_CLEANUP_FAILED_WARNING,
      }
    }
    return result
  }

  // If native storage still contains a Codex record and unrelated secrets, a
  // plaintext Codex-only fallback would be shadowed by the stale native record.
  // Deleting the native document would remove unrelated secrets, so fail closed.
  if (previousNativeCodex && hasNonCodexStorageFields(previous)) {
    return result
  }

  const fallbackResult = writeCodexToPlainTextStorage(
    next[CODEX_STORAGE_KEY] as CodexCredentialBlob,
  )
  if (fallbackResult.success) {
    if (previousNativeCodex && !secureStorage.delete()) {
      return {
        success: false,
        warning: CODEX_FALLBACK_NATIVE_DELETE_FAILED_WARNING,
      }
    }

    if (!previousNativeCodex && !hasNonCodexStorageFields(previous)) {
      secureStorage.delete()
    }

    const storedCodex = normalizeCodexCredentialBlob(next[CODEX_STORAGE_KEY])
    inMemoryLastRefreshFailureAt = storedCodex?.lastRefreshFailureAt ?? null
    return {
      success: true,
      warning: fallbackResult.warning,
    }
  }

  return fallbackResult.warning ? fallbackResult : result
}

export function attachCodexProfileIdToStoredCredentials(profileId: string): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: false, warning: 'Bare mode: secure storage is disabled.' }
  }

  const current = readCodexCredentials()
  if (!current) {
    return {
      success: false,
      warning: 'Codex credentials are not stored securely yet.',
    }
  }

  return saveCodexCredentials({
    ...current,
    profileId,
  })
}

function persistCodexRefreshFailure(
  credentials: CodexCredentialBlob,
  occurredAt: number,
): void {
  const result = saveCodexCredentials({
    ...credentials,
    lastRefreshFailureAt: occurredAt,
  })
  if (!result.success) {
    inMemoryLastRefreshFailureAt = occurredAt
  }
}

export function clearCodexCredentials(): {
  success: boolean
  warning?: string
} {
  if (isBareMode()) {
    return { success: true }
  }

  const secureStorage = getCodexPrimarySecureStorage()
  const previous = secureStorage.read()
  const previousCodex = normalizeCodexCredentialBlob(
    previous?.[CODEX_STORAGE_KEY],
  )

  if (!previousCodex) {
    const plaintextResult = removeCodexFromPlainTextStorage()
    if (plaintextResult.success) {
      inMemoryLastRefreshFailureAt = null
    }
    return plaintextResult
  }

  const next = { ...getRecord(previous) }
  delete next[CODEX_STORAGE_KEY]
  const result = secureStorage.update(next as SecureStorageData)
  if (!result.success) {
    return result
  }

  const plaintextResult = removeCodexFromPlainTextStorage()
  if (!plaintextResult.success) {
    return plaintextResult
  }

  inMemoryLastRefreshFailureAt = null
  return result
}

export async function refreshCodexAccessTokenIfNeeded(options?: {
  force?: boolean
}): Promise<{
  refreshed: boolean
  credentials?: CodexCredentialBlob
}> {
  if (isBareMode()) {
    return { refreshed: false }
  }

  if (process.env.CODEX_API_KEY?.trim()) {
    return { refreshed: false }
  }

  const current = await readCodexCredentialsAsync()
  if (!current) {
    return { refreshed: false }
  }

  const refreshToken = current.refreshToken
  if (!refreshToken) {
    return { refreshed: false, credentials: current }
  }

  if (!options?.force && !shouldRefreshCodexToken(current)) {
    return { refreshed: false, credentials: current }
  }

  if (!options?.force && isWithinRefreshFailureCooldown(current)) {
    return { refreshed: false, credentials: current }
  }

  if (inFlightCodexRefresh) {
    return inFlightCodexRefresh
  }

  inFlightCodexRefresh = (async () => {
    const refreshAttemptedAt = Date.now()

    try {
      const body = new URLSearchParams({
        client_id: getCodexOAuthClientId(),
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      })

      const { signal, cleanup } = createCombinedAbortSignal(undefined, {
        timeoutMs: 15_000,
      })
      let payload: CodexTokenRefreshResponse
      try {
        const response = await fetch(CODEX_REFRESH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal,
        })

        if (!response.ok) {
          const bodyText = await response.text().catch(() => '')
          throw new Error(getRefreshErrorMessage(response.status, bodyText))
        }

        payload = (await response.json()) as CodexTokenRefreshResponse
      } finally {
        cleanup()
      }
      const accessToken = asTrimmedString(payload.access_token)
      if (!accessToken) {
        throw new Error(
          'Codex token refresh succeeded without a new access token.',
        )
      }

      const next: CodexCredentialBlob = {
        accessToken,
        refreshToken:
          asTrimmedString(payload.refresh_token) ?? current.refreshToken,
        idToken: asTrimmedString(payload.id_token) ?? current.idToken,
        accountId:
          parseChatgptAccountId(payload.id_token) ??
          parseChatgptAccountId(payload.access_token) ??
          current.accountId,
        lastRefreshAt: Date.now(),
      }

      const idTokenForExchange = next.idToken ?? current.idToken
      if (idTokenForExchange) {
        next.apiKey = await exchangeCodexIdTokenForApiKey(
          idTokenForExchange,
        ).catch(() => undefined)
      }

      const saveResult = saveCodexCredentials(next)
      if (!saveResult.success) {
        throw new Error(
          saveResult.warning ??
            'Codex token refresh succeeded but credentials could not be saved.',
        )
      }

      return {
        refreshed: true,
        credentials: next,
      }
    } catch (error) {
      persistCodexRefreshFailure(current, refreshAttemptedAt)
      throw error
    } finally {
      inFlightCodexRefresh = null
    }
  })()

  return inFlightCodexRefresh
}
