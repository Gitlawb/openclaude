import React from 'react'
import { Box, Link, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { getAPIProvider, type APIProvider } from '../utils/model/providers.js'

type Props = {
  onDone: () => void
}

const COST_THRESHOLD_PROVIDER_LABELS: Partial<Record<APIProvider, string>> = {
  firstParty: 'Anthropic API',
  bedrock: 'AWS Bedrock',
  vertex: 'Google Vertex',
  foundry: 'Azure Foundry',
  openai: 'OpenAI-compatible API',
  gemini: 'Gemini API',
}

export function getCostThresholdProviderLabel(): string {
  const provider = getAPIProvider()
  return COST_THRESHOLD_PROVIDER_LABELS[provider] ?? 'API'
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
