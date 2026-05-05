import React from 'react'
import { Box, Link, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { getAPIProvider, type APIProvider } from '../utils/model/providers.js'
import { getCostThresholdProviderLabelForProvider } from './CostThresholdProviderLabel.js'

type Props = {
  onDone: () => void
}

export function getCostThresholdProviderLabel(
  provider: APIProvider = getAPIProvider(),
): string {
  return getCostThresholdProviderLabelForProvider(provider)
}

export function CostThresholdDialog({ onDone }: Props): React.ReactNode {
  const providerLabel = getCostThresholdProviderLabel()
  return (
    <Dialog
      title={`You've spent $5 on the ${providerLabel} this session.`}
      onCancel={onDone}
    >
      <Box flexDirection="column">
        <Text>Learn more about how to monitor your spending:</Text>
        <Link url="https://code.claude.com/docs/en/costs" />
      </Box>
      <Select
        options={[
          {
            value: 'ok',
            label: 'Got it, thanks!',
          },
        ]}
        onChange={onDone}
      />
    </Dialog>
  )
}
