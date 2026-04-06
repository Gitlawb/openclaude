import * as React from 'react';
import { useEffect, useMemo } from 'react';
import { Box, Text } from 'src/ink.js';
import { getDynamicConfig_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js';
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js';
const CONFIG_NAME = 'tengu-top-of-feed-tip';
export function EmergencyTip(): React.ReactNode {
  const tip = useMemo(getTipOfFeed, []);
  // Memoize to prevent re-reads after we save - we want the value at mount time
  const lastShownTip = useMemo(() => getGlobalConfig().lastShownEmergencyTip, []);

  // Only show if this is a new/different tip
  const shouldShow = tip.tip && tip.tip !== lastShownTip;

  // Save the tip we're showing so we don't show it again
  useEffect(() => {
    if (shouldShow) {
      saveGlobalConfig(current => {
        if (current.lastShownEmergencyTip === tip.tip) return current;
        return {
          ...current,
          lastShownEmergencyTip: tip.tip
        };
      });
    }
  }, [shouldShow, tip.tip]);
  if (!shouldShow) {
    return null;
  }
  return <Box paddingLeft={2} flexDirection="column">
      <Text {...tip.color === 'warning' ? {
      color: 'warning'
    } : tip.color === 'error' ? {
      color: 'error'
    } : {
      dimColor: true
    }}>
        {tip.tip}
      </Text>
    </Box>;
}
type TipOfFeed = {
  tip: string;
  color?: 'dim' | 'warning' | 'error';
};
const DEFAULT_TIP: TipOfFeed = {
  tip: '',
  color: 'dim'
};

/**
 * Get the tip of the feed from dynamic config with caching
 * Returns cached value immediately, updates in background
 */
function getTipOfFeed(): TipOfFeed {
  return getDynamicConfig_CACHED_MAY_BE_STALE<TipOfFeed>(CONFIG_NAME, DEFAULT_TIP);
}
