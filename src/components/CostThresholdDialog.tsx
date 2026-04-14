import React from 'react'
import { Box, Link, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { getAPIProvider } from '../utils/model/providers.js'

type Props = {
  onDone: () => void
}

function getProviderLabel(): string {
  const provider = getAPIProvider()
  switch (provider) {
    case 'firstParty':
      return 'Anthropic API'
    case 'bedrock':
      return 'AWS Bedrock'
    case 'vertex':
      return 'Google Vertex'
    case 'foundry':
      return 'Azure Foundry'
    case 'openai':
      return 'OpenAI-compatible API'
    case 'gemini':
      return 'Google Gemini'
    default:
      return 'API'
  }
}

export function CostThresholdDialog({ onDone }: Props): React.ReactNode {
  const providerLabel = getProviderLabel()
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
