import * as React from 'react';
import type { Notification } from '../context/notifications.js';
import { Text } from '../ink.js';
import { logForDebugging } from '../utils/debug.js';
import { checkAndInstallOfficialMarketplace } from '../utils/plugins/officialMarketplaceStartupCheck.js';
import { useStartupNotification } from './notifs/useStartupNotification.js';

/**
 * Hook that handles official marketplace auto-installation and shows
 * notifications for success/failure in the bottom right of the REPL.
 */
export function useOfficialMarketplaceNotification() {
  useStartupNotification(_temp);
}
async function _temp() {
  const result = await checkAndInstallOfficialMarketplace();
  const notifs = [];
  if (result.configSaveFailed) {
    logForDebugging("Showing marketplace config save failure notification");
    // @ts-expect-error any-to-never (stub types cause narrowing)
    notifs.push({
      key: "marketplace-config-save-failed",
      jsx: <Text color="error">Failed to save marketplace retry info · Check ~/.openclaude.json permissions</Text>,
      priority: "immediate",
      timeoutMs: 10000
    });
  }
  if (result.installed) {
    logForDebugging("Showing marketplace installation success notification");
    // @ts-expect-error any-to-never (stub types cause narrowing)
    notifs.push({
      key: "marketplace-installed",
      jsx: <Text color="success">✓ Anthropic marketplace installed · /plugin to see available plugins</Text>,
      priority: "immediate",
      timeoutMs: 7000
    });
  } else {
    if (result.skipped && result.reason === "unknown") {
      logForDebugging("Showing marketplace installation failure notification");
      // @ts-expect-error any-to-never (stub types cause narrowing)
      notifs.push({
        key: "marketplace-install-failed",
        jsx: <Text color="warning">Failed to install Anthropic marketplace · Will retry on next startup</Text>,
        priority: "immediate",
        timeoutMs: 8000
      });
    }
  }
  return notifs;
}
