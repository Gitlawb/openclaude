import type { SettingsWriteResult } from '../utils/settings/settings.js'

/** Build a complete settings-write lifecycle result for dependency-injected tests. */
export function settingsWriteResult({
  error = null,
  written,
  committed = written,
  cacheInvalidated = written,
  sessionNotified = false,
  unchanged,
}: {
  error?: Error | null
  written: boolean
  committed?: boolean
  cacheInvalidated?: boolean
  sessionNotified?: boolean
  unchanged?: boolean
}): SettingsWriteResult {
  if (committed && !written) {
    throw new Error(
      'A settings write cannot be committed without written bytes',
    )
  }
  return {
    status: committed
      ? 'committed'
      : written
        ? 'written-uncommitted'
        : error
          ? 'rejected'
          : 'not-requested',
    bytesOnDisk: written,
    committed,
    cacheInvalidated,
    sessionNotified,
    error,
    written,
    ...(unchanged === undefined ? {} : { unchanged }),
  }
}
