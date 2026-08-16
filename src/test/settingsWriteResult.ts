import type { SettingsWriteResult } from '../utils/settings/settings.js'

/** Build a complete settings-write lifecycle result for dependency-injected tests. */
export function settingsWriteResult({
  error = null,
  written,
  committed = written,
  unchanged,
}: {
  error?: Error | null
  written: boolean
  committed?: boolean
  unchanged?: boolean
}): SettingsWriteResult {
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
    cacheInvalidated: written,
    sessionNotified: false,
    error,
    written,
    ...(unchanged === undefined ? {} : { unchanged }),
  }
}
