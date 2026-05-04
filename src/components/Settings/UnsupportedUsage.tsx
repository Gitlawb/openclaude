import * as React from 'react'

import { Box, Text } from '../../ink.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'

type UnsupportedUsageProps = {
  providerLabel: string
}

export function UnsupportedUsage({
  providerLabel,
}: UnsupportedUsageProps): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        Usage details are not currently available for {providerLabel}.
      </Text>
      <Text dimColor>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Settings"
          fallback="Esc"
          description="cancel"
        />
      </Text>
    </Box>
  )
}
