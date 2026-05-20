import React from 'react'
import { Box, Text } from '../../ink.js'

type Props = {
  message: unknown
}

export function SnipBoundaryMessage(_props: Props): React.ReactNode {
  return (
    <Box marginY={1}>
      <Text dimColor={true}>Earlier context was trimmed from the active conversation.</Text>
    </Box>
  )
}
