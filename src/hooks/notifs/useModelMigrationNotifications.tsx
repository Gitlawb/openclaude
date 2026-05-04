import type { Notification } from 'src/context/notifications.js';
import { type GlobalConfig, getGlobalConfig } from 'src/utils/config.js';
import { useStartupNotification } from './useStartupNotification.js';

// Shows a one-time notification right after a model migration writes its
// timestamp to config. Each entry reads its own timestamp field(s) and emits
// a notification if the write happened within the last 3s (i.e. this launch).
// Future model migrations: add an entry to MIGRATIONS below.
const MIGRATIONS: ((c: GlobalConfig) => Notification | undefined)[] = [
// Sonnet 4.5 → 4.6 (pro/max/team premium)
c => {
  if (!recent(c.sonnet45To46MigrationTimestamp)) return;
  return {
    key: 'sonnet-46-update',
    text: 'Model updated to Sonnet 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: 3000
  };
},
// Opus Pro → default, or pinned 4.0/4.1 → opus alias. Both land on the
// current Opus default (4.6 for 1P).
c => {
  const isLegacyRemap = Boolean(c.legacyOpusMigrationTimestamp);
  const ts = c.legacyOpusMigrationTimestamp ?? c.opusProMigrationTimestamp;
  if (!recent(ts)) return;
  return {
    key: 'opus-pro-update',
    text: isLegacyRemap ? 'Model updated to Opus 4.6 · Set CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP=1 to opt out' : 'Model updated to Opus 4.6',
    color: 'suggestion',
    priority: 'high',
    timeoutMs: isLegacyRemap ? 8000 : 3000
  };
}];
export function useModelMigrationNotifications() {
  useStartupNotification(_temp);
}
function _temp() {
  const config = getGlobalConfig();
  const notifs = [];
  for (const migration of MIGRATIONS) {
    const notif = migration(config);
    if (notif) {
      // @ts-expect-error any-to-never (stub types cause narrowing)
      notifs.push(notif as any);
    }
  }
  return notifs.length > 0 ? notifs : null;
}
function recent(ts: number | undefined): boolean {
  return ts !== undefined && Date.now() - ts < 3000;
}
