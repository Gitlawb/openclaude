import { feature } from 'bun:bundle';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { migrateAutoUpdatesToSettings } from './migrateAutoUpdatesToSettings.js';
import { migrateBypassPermissionsAcceptedToSettings } from './migrateBypassPermissionsAcceptedToSettings.js';
import { migrateEnableAllProjectMcpServersToSettings } from './migrateEnableAllProjectMcpServersToSettings.js';
import { migrateFennecToOpus } from './migrateFennecToOpus.js';
import { migrateLegacyOpusToCurrent } from './migrateLegacyOpusToCurrent.js';
import { migrateOpusToOpus1m } from './migrateOpusToOpus1m.js';
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from './migrateReplBridgeEnabledToRemoteControlAtStartup.js';
import { migrateSonnet1mToSonnet45 } from './migrateSonnet1mToSonnet45.js';
import { migrateSonnet45ToSonnet46 } from './migrateSonnet45ToSonnet46.js';
import { resetAutoModeOptInForDefaultOffer } from './resetAutoModeOptInForDefaultOffer.js';
import { resetProToOpusDefault } from './resetProToOpusDefault.js';
import { migrateChangelogFromConfig } from '../utils/releaseNotes.js';

// @[MODEL LAUNCH]: Consider any migrations you may need for model strings. See migrateSonnet1mToSonnet45.ts for an example.
// Bump this when adding a new sync migration so existing users re-run the set.
export const CURRENT_MIGRATION_VERSION = 11;

/**
 * Orchestrates all database and configuration migrations.
 * Extracted from main.tsx for architectural clarity.
 */
export function runMigrations(): void {
  if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
    migrateAutoUpdatesToSettings();
    migrateBypassPermissionsAcceptedToSettings();
    migrateEnableAllProjectMcpServersToSettings();
    resetProToOpusDefault();
    migrateSonnet1mToSonnet45();
    migrateLegacyOpusToCurrent();
    migrateSonnet45ToSonnet46();
    migrateOpusToOpus1m();
    migrateReplBridgeEnabledToRemoteControlAtStartup();
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      resetAutoModeOptInForDefaultOffer();
    }
    if ("external" === 'ant') {
      migrateFennecToOpus();
    }
    saveGlobalConfig(prev => prev.migrationVersion === CURRENT_MIGRATION_VERSION ? prev : {
      ...prev,
      migrationVersion: CURRENT_MIGRATION_VERSION
    });
  }
  // Async migration - fire and forget since it's non-blocking
  migrateChangelogFromConfig().catch(() => {
    // Silently ignore migration errors - will retry on next startup
  });
}
