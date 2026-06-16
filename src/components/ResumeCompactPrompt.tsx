import React from 'react'
import { Box, Text } from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import { ProgressBar } from './design-system/ProgressBar.js'
import { getContextWindowForModel } from '../utils/context.js'
import { getEffectiveContextWindowSize } from '../services/compact/autoCompact.js'
import { getSdkBetas } from '../bootstrap/state.js'

type Props = {
  tokenCount: number
  model: string
  onDone: (choice: 'yes' | 'no') => void
}

export function ResumeCompactPrompt({ tokenCount, model, onDone }: Props): React.ReactNode {
  const contextWindow = getContextWindowForModel(model, getSdkBetas())
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const percentUsed = Math.round((tokenCount / contextWindow) * 100)
  const effectivePercentUsed = Math.round((tokenCount / effectiveWindow) * 100)

  return (
    <Dialog
      title="This session is large. Compact it before continuing?"
      onCancel={() => onDone('no')}
    >
      <Box flexDirection="column" gap={1}>
        <Box>
          <Text>
            Context: {tokenCount.toLocaleString()} / {contextWindow.toLocaleString()} tokens ({percentUsed}%)
          </Text>
        </Box>
        <Box>
          <ProgressBar ratio={tokenCount / contextWindow} width={40} fillColor="claudeBlue" emptyColor="border" />
        </Box>
        <Box>
          <Text dimColor>
            Effective window: {effectivePercentUsed}% used. Compacting will summarize the conversation to free up context.
          </Text>
        </Box>
        <Select
          options={[
            {
              value: 'yes',
              label: 'Yes, compact now (recommended)',
            },
            {
              value: 'no',
              label: 'No, continue without compacting',
            },
          ]}
          onChange={(value: 'yes' | 'no') => onDone(value)}
        />
      </Box>
    </Dialog>
  )
}
