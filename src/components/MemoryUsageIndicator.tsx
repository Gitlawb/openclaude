import * as React from 'react';
import { useMemoryUsage } from '../hooks/useMemoryUsage.js';
import { Box, Text } from '../ink.js';
import { formatFileSize } from '../utils/format.js';
export function MemoryUsageIndicator(): React.ReactNode {
  // Ant-only: the /heapdump link is an internal debugging aid. Gating before
  // the hook means the 10s polling interval is never set up in external builds.
  // USER_TYPE is a build-time constant, so the hook call below is either always
  // reached or dead-code-eliminated — never conditional at runtime.
  if ("external" !== 'ant') {
    return null;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  // biome-ignore lint/correctness/useHookAtTopLevel: USER_TYPE is a build-time constant
  const memoryUsage = useMemoryUsage();
  if (!memoryUsage) {
    return null;
  }
  const {
    heapUsed,
    status
  } = memoryUsage;

  // Only show indicator when memory usage is high or critical
  if (status === 'normal') {
    return null;
  }
  const formattedSize = formatFileSize(heapUsed);
  const color = status === 'critical' ? 'error' : 'warning';
  return <Box>
      <Text color={color} wrap="truncate">
        High memory usage ({formattedSize}) · /heapdump
      </Text>
    </Box>;
}
