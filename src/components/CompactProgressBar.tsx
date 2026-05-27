import React from 'react'
import { Box, Text } from '../ink.js'
import { ProgressBar } from './design-system/ProgressBar.js'

type Props = {
  ratio: number
}

export function CompactProgressBar({ ratio }: Props): React.ReactNode {
  return (
    <Box flexDirection="row" paddingLeft={1} gap={1}>
      <Text color="claudeBlue">
        <ProgressBar ratio={ratio} width={30} fillColor="claudeBlue" emptyColor="border" />
      </Text>
      <Text dimColor>{Math.round(ratio * 100)}%</Text>
    </Box>
  )
}
