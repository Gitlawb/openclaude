import React from 'react'
import { Box, Text } from '../../ink.js'

/** Keep status fields on one row; only the model name may shrink. */
export function ContextUsageRow({ provider, model, columns, pct, input, window, rate, generating }: {
  provider: string; model: string; columns: number; pct: number;
  input: string; window: string; rate: number; generating: boolean;
}) {
  const contextColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : undefined
  return <Box height={1} gap={1} flexShrink={1} minWidth={0} overflow="hidden">
    <Box flexShrink={0}><Text color="claude">{provider}</Text></Box>
    <Box flexShrink={1} minWidth={0} overflow="hidden"><Text dimColor wrap="truncate-end">{model}</Text></Box>
    <Box flexShrink={0}><Text dimColor>· context <Text color={contextColor} dimColor={contextColor === undefined}>{pct}%</Text></Text></Box>
    {columns >= 70 && <Box flexShrink={0}><Text dimColor>· {input} / {window}</Text></Box>}
    {columns >= 80 && rate > 0 && <Box flexShrink={0}><Text dimColor={!generating} color={generating ? 'success' : undefined}>· {rate} tok/s</Text></Box>}
  </Box>
}
