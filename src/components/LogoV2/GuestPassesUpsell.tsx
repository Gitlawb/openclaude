import { c as _c } from "react-compiler-runtime";
import { useState } from 'react';
import { Text } from '../../ink.js';
import { logEvent } from '../../services/analytics/index.js';
import { checkCachedPassesEligibility, formatCreditAmount, getCachedReferrerReward, getCachedRemainingPasses } from '../../services/api/referral.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
function resetIfPassesRefreshed(): void {
  const remaining = getCachedRemainingPasses();
  if (remaining == null || remaining <= 0) return;
  const config = getGlobalConfig();
  const lastSeen = config.passesLastSeenRemaining ?? 0;
  if (remaining > lastSeen) {
    saveGlobalConfig(prev => ({
      ...prev,
      passesUpsellSeenCount: 0,
      hasVisitedPasses: false,
      passesLastSeenRemaining: remaining
    }));
  }
}
function shouldShowGuestPassesUpsell(): boolean {
  const {
    eligible,
    hasCache
  } = checkCachedPassesEligibility();
  // Only show if eligible and cache exists (don't block on fetch)
  if (!eligible || !hasCache) return false;
  // Reset upsell counters if passes were refreshed (covers both campaign change and pass refresh)
  resetIfPassesRefreshed();
  const config = getGlobalConfig();
  if ((config.passesUpsellSeenCount ?? 0) >= 3) return false;
  if (config.hasVisitedPasses) return false;
  return true;
}
export function useShowGuestPassesUpsell() {
  const [show] = useState(_temp);
  return show;
}
function _temp() {
  return shouldShowGuestPassesUpsell();
}
export function incrementGuestPassesSeenCount(): void {
  let newCount = 0;
  saveGlobalConfig(prev => {
    newCount = (prev.passesUpsellSeenCount ?? 0) + 1;
    return {
      ...prev,
      passesUpsellSeenCount: newCount
    };
  });
  logEvent('tengu_guest_passes_upsell_shown', {
    seen_count: newCount
  });
}

// Condensed layout for mini welcome screen
export function GuestPassesUpsell() {
  const $ = _c(1);
  let t0;
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) {
    const reward = getCachedReferrerReward();
    t0 = <Text dimColor={true}><Text color="claude">[✻]</Text> <Text color="claude">[✻]</Text>{" "}<Text color="claude">[✻]</Text> ·{" "}{reward ? `Share Neural Network and earn ${formatCreditAmount(reward)} of extra usage · /passes` : "3 guest passes at /passes"}</Text>;
    $[0] = t0;
  } else {
    t0 = $[0];
  }
  return t0;
}
