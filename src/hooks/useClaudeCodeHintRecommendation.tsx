import { c as _c } from "react-compiler-runtime";
/**
 * Surfaces plugin-install prompts driven by `<claude-code-hint />` tags
 * that CLIs/SDKs emit to stderr. See docs/claude-code-hints.md.
 *
 * Show-once semantics: each plugin is prompted for at most once ever,
 * recorded in config regardless of yes/no. The pre-store gate in
 * maybeRecordPluginHint already dropped installed/shown/capped hints, so
 * anything that reaches this hook is worth resolving.
 */

import * as React from 'react';
import { useNotifications } from '../context/notifications.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED, logEvent } from '../services/analytics/index.js';
import { clearPendingHint, getPendingHintSnapshot, markShownThisSession, subscribeToPendingHint } from '../utils/claudeCodeHints.js';
import { logForDebugging } from '../utils/debug.js';
import { disableHintRecommendations, markHintPluginShown, type PluginHintRecommendation, resolvePluginHint } from '../utils/plugins/hintRecommendation.js';
import { installPluginFromMarketplace } from '../utils/plugins/pluginInstallationHelpers.js';
import { installPluginAndNotify, usePluginRecommendationBase } from './usePluginRecommendationBase.js';
type UseClaudeCodeHintRecommendationResult = {
  recommendation: PluginHintRecommendation | null;
  handleResponse: (response: 'yes' | 'no' | 'disable') => void;
};
export function useClaudeCodeHintRecommendation() {
  const $ = _c(11);
  const pendingHint = React.useSyncExternalStore(subscribeToPendingHint, getPendingHintSnapshot);
  const {
    addNotification
  } = useNotifications();
  const {
    recommendation,
    clearRecommendation,
    tryResolve
  } = usePluginRecommendationBase();
  let t0;
  let t1;
  if ($[0] !== pendingHint || $[1] !== tryResolve) {
    t0 = () => {
      if (!pendingHint) {
        return;
      }
      tryResolve(async () => {
        const resolved = await resolvePluginHint(pendingHint);
        if (resolved) {
          logForDebugging(`[useClaudeCodeHintRecommendation] surfacing ${resolved.pluginId} from ${resolved.sourceCommand}`);
          markShownThisSession();
        }
        if (getPendingHintSnapshot() === pendingHint) {
          clearPendingHint();
        }
        return resolved;
      });
    };
    t1 = [pendingHint, tryResolve];
    $[0] = pendingHint;
    $[1] = tryResolve;
    $[2] = t0;
    $[3] = t1;
  } else {
    t0 = $[2];
    t1 = $[3];
  }
  React.useEffect(t0, t1);
  let t2;
  if ($[4] !== addNotification || $[5] !== clearRecommendation || $[6] !== recommendation) {
    t2 = response => {
      if (!recommendation) {
        return;
      }
      markHintPluginShown(recommendation.pluginId);
      logEvent("tengu_plugin_hint_response", {
        _PROTO_plugin_name: recommendation.pluginName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        _PROTO_marketplace_name: recommendation.marketplaceName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
        response: response as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      });
      bb15: switch (response) {
        case "yes":
          {
            const {
              pluginId,
              pluginName,
              marketplaceName
            } = recommendation;
            installPluginAndNotify(pluginId, pluginName, "hint-plugin", addNotification, async pluginData => {
              const result = await installPluginFromMarketplace({
                pluginId,
                entry: pluginData.entry,
                marketplaceName,
                scope: "user",
                trigger: "hint"
              });
              if (!result.success) {
                throw new Error(result.error);
              }
            });
            break bb15;
          }
        case "disable":
          {
            disableHintRecommendations();
            break bb15;
          }
        case "no":
      }
      clearRecommendation();
    };
    $[4] = addNotification;
    $[5] = clearRecommendation;
    $[6] = recommendation;
    $[7] = t2;
  } else {
    t2 = $[7];
  }
  const handleResponse = t2;
  let t3;
  if ($[8] !== handleResponse || $[9] !== recommendation) {
    t3 = {
      recommendation,
      handleResponse
    };
    $[8] = handleResponse;
    $[9] = recommendation;
    $[10] = t3;
  } else {
    t3 = $[10];
  }
  return t3;
}
