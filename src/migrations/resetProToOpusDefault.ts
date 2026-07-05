import { logEvent } from 'src/services/analytics/index.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'

export function resetProToOpusDefault(): void {
  const config = getGlobalConfig()

  if (config.opusProMigrationComplete) {
    return
  }

  // Not applicable for non-first-party providers — just mark complete.
  saveGlobalConfig(current => ({
    ...current,
    opusProMigrationComplete: true,
  }))
  logEvent('tengu_reset_pro_to_opus_default', { skipped: true })
}
