import type { SecureStorage, SecureStorageData, SecureStorageReadResult } from './index.js'

/**
 * Creates a fallback storage that tries to use the primary storage first,
 * and if that fails, falls back to the secondary storage
 */
export function createFallbackStorage(
  primary: SecureStorage,
  secondary: SecureStorage,
): SecureStorage {
  return {
    name: `${primary.name}-with-${secondary.name}-fallback`,
    read(): SecureStorageData {
      const result = primary.read()
      if (result !== null && result !== undefined) {
        return result
      }
      return secondary.read() || {}
    },
    readResult(): SecureStorageReadResult {
      const result = primary.readResult?.()
      if (result?.kind === 'ok') return result
      const fallback = secondary.readResult?.()
      if (result?.kind === 'error') {
        // A secondary plaintext record is an intentional migration fallback,
        // but an empty secondary store must not turn an unavailable native
        // vault into a false "missing" result.
        if (fallback?.kind === 'ok') return fallback
        return { kind: 'error', warning: result.warning ?? fallback?.warning }
      }
      if (fallback) return fallback
      const legacy = secondary.read()
      return legacy ? { kind: 'ok', data: legacy } : { kind: 'missing' }
    },
    async readAsync(): Promise<SecureStorageData | null> {
      const result = await primary.readAsync()
      if (result !== null && result !== undefined) {
        return result
      }
      return (await secondary.readAsync()) || {}
    },
    async readResultAsync(): Promise<SecureStorageReadResult> {
      const result = primary.readResultAsync
        ? await primary.readResultAsync()
        : primary.read() ? { kind: 'ok' as const, data: primary.read()! } : { kind: 'missing' as const }
      if (result.kind === 'ok') return result
      if (secondary.readResultAsync) {
        const fallback = await secondary.readResultAsync()
        if (result.kind === 'error' && fallback.kind !== 'ok') {
          return { kind: 'error', warning: result.warning ?? fallback.warning }
        }
        return fallback
      }
      const fallback = await secondary.readAsync()
      if (fallback) return { kind: 'ok', data: fallback }
      return result.kind === 'error' ? result : { kind: 'missing' }
    },
    update(
      data: SecureStorageData,
      options?: { preserveProviderAccounts?: boolean; lockHeld?: boolean; replaceCorrupt?: boolean },
    ): { success: boolean; warning?: string } {
      // Capture state before update
      const primaryDataBefore = primary.read()

      const result = primary.update(data, options)

      if (result.success) {
        // Delete secondary when migrating to primary for the first time
        // This preserves credentials when sharing .claude between host and containers
        // See: https://github.com/anthropics/claude-code/issues/1414
        if (primaryDataBefore === null) {
          secondary.delete()
        }
        return result
      }

      const fallbackResult = secondary.update(data, options)

      if (fallbackResult.success) {
        // Primary write failed but primary may still hold an *older* valid
        // entry. read() prefers primary whenever it returns non-null, so that
        // stale entry would shadow the fresh data we just wrote to secondary —
        // e.g. a refresh token the server has already rotated away, causing a
        // /login loop (#30337). Best-effort delete; if this also fails the
        // user's keychain is in a bad state we can't fix from here.
        if (primaryDataBefore !== null) {
          primary.delete()
        }
        return {
          success: true,
          warning: fallbackResult.warning,
        }
      }

      return { success: false }
    },
    delete(): boolean {
      const primarySuccess = primary.delete()
      const secondarySuccess = secondary.delete()

      return primarySuccess || secondarySuccess
    },
  }
}
