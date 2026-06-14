import React from 'react'
import { Box, Text } from '../ink.js'

const BAR_WIDTH = 16

type Props = {
  ratio: number
}

export function CompactProgressBar({ ratio }: Props): React.ReactNode {
  const clamped = Math.min(1, Math.max(0, ratio))
  const filled = Math.round(clamped * BAR_WIDTH)
  return (
    <Box flexDirection="row" paddingLeft={2} gap={1}>
      <Text>
        <Text dimColor>[</Text>
        <Text color="claudeBlue">{'█'.repeat(filled)}</Text>
        <Text dimColor>{'·'.repeat(BAR_WIDTH - filled)}</Text>
        <Text dimColor>]</Text>
      </Text>
      <Text dimColor>{Math.round(clamped * 100)}%</Text>
    </Box>
  )
}
