import { c as _c } from "react-compiler-runtime";
/**
 * Shared state machine + install helper for plugin-recommendation hooks
 * (LSP, claude-code-hint). Centralizes the gate chain, async-guard,
 * and success/failure notification JSX so new sources stay small.
 */

import figures from 'figures';
import * as React from 'react';
import { getIsRemoteMode } from '../bootstrap/state.js';
import type { useNotifications } from '../context/notifications.js';
import { Text } from '../ink.js';
import { logError } from '../utils/log.js';
import { getPluginById } from '../utils/plugins/marketplaceManager.js';
type AddNotification = ReturnType<typeof useNotifications>['addNotification'];
type PluginData = NonNullable<Awaited<ReturnType<typeof getPluginById>>>;

/**
 * Call tryResolve inside a useEffect; it applies standard gates (remote
 * mode, already-showing, in-flight) then runs resolve(). Non-null return
 * becomes the recommendation. Include tryResolve in effect deps — its
 * identity tracks recommendation, so clearing re-triggers resolution.
 */
export function usePluginRecommendationBase() {
  const $ = _c(6);
  const [recommendation, setRecommendation] = React.useState(null);
  const isCheckingRef = React.useRef(false);
  let t0;
  if ($[0] !== recommendation) {
    t0 = resolve => {
      if (getIsRemoteMode()) {
        return;
      }
      if (recommendation) {
        return;
      }
      if (isCheckingRef.current) {
        return;
      }
      isCheckingRef.current = true;
      resolve().then(rec => {
        if (rec) {
          setRecommendation(rec);
        }
      }).catch(logError).finally(() => {
        isCheckingRef.current = false;
      });
    };
    $[0] = recommendation;
    $[1] = t0;
  } else {
    t0 = $[1];
  }
  const tryResolve = t0;
  let t1;
  if ($[2] === Symbol.for("react.memo_cache_sentinel")) {
    t1 = () => setRecommendation(null);
    $[2] = t1;
  } else {
    t1 = $[2];
  }
  const clearRecommendation = t1;
  let t2;
  if ($[3] !== recommendation || $[4] !== tryResolve) {
    t2 = {
      recommendation,
      clearRecommendation,
      tryResolve
    };
    $[3] = recommendation;
    $[4] = tryResolve;
    $[5] = t2;
  } else {
    t2 = $[5];
  }
  return t2;
}

/** Look up plugin, run install(), emit standard success/failure notification. */
export async function installPluginAndNotify(pluginId: string, pluginName: string, keyPrefix: string, addNotification: AddNotification, install: (pluginData: PluginData) => Promise<void>): Promise<void> {
  try {
    const pluginData = await getPluginById(pluginId);
    if (!pluginData) {
      throw new Error(`Plugin ${pluginId} not found in marketplace`);
    }
    await install(pluginData);
    addNotification({
      key: `${keyPrefix}-installed`,
      jsx: <Text color="success">
          {figures.tick} {pluginName} installed · restart to apply
        </Text>,
      priority: 'immediate',
      timeoutMs: 5000
    });
  } catch (error) {
    logError(error);
    addNotification({
      key: `${keyPrefix}-install-failed`,
      jsx: <Text color="error">Failed to install {pluginName}</Text>,
      priority: 'immediate',
      timeoutMs: 5000
    });
  }
}
