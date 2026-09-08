import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import {
  getDefaultOpusModel,
  getDefaultSonnetModel,
  getMarketingNameForModel,
} from 'src/utils/model/model.js';
import { useStartupNotification } from './useStartupNotification.js';

// Shows a one-time notification right after a model migration writes its
// timestamp to config. Each entry reads its own timestamp field(s) and emits
// a notification if the write happened within the last 3s (i.e. this launch).
// Future model migrations: add an entry to getMigrationNotifications below.
export function getMigrationNotifications(config: Partial<GlobalConfig>): Notification[] {
  const notifs: Notification[] = [];

  // Sonnet migration (lands on the resolved default Sonnet alias)
  if (recent(config.sonnet45To46MigrationTimestamp)) {
    const sonnetName =
      getMarketingNameForModel(getDefaultSonnetModel()) ?? 'Sonnet 5';
    notifs.push({
      key: 'sonnet-46-update',
      text: `Model updated to ${sonnetName}`,
      color: 'suggestion',
      priority: 'high',
      timeoutMs: 3000,
    });
  }

  // Opus Pro → default, or pinned 4.0/4.1 → opus alias. Both land on the
  // current Opus default.
  const hasRecentLegacy = recent(config.legacyOpusMigrationTimestamp);
  const hasRecentPro = !hasRecentLegacy && recent(config.opusProMigrationTimestamp);
  if (hasRecentLegacy || hasRecentPro) {
    const isLegacyRemap = hasRecentLegacy;
    const opusName =
      getMarketingNameForModel(getDefaultOpusModel()) ?? 'Opus 5';
    notifs.push({
      key: 'opus-pro-update',
      text: isLegacyRemap
        ? `Model updated to ${opusName} · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out`
        : `Model updated to ${opusName}`,
      color: 'suggestion',
      priority: 'high',
      timeoutMs: isLegacyRemap ? 8000 : 3000,
    });
  }

  return notifs;
}

export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = getMigrationNotifications(config);
  return notifs.length > 0 ? notifs : null;
}
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
