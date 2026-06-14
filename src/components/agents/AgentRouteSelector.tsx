import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from '../../ink.js'
import {
  CUSTOM_MODEL_VALUE,
  CLEAR_ROUTE_VALUE,
  buildRouteOptions,
  clearAgentRoute,
  currentRouteValue,
  setAgentRoute,
  type CurrentAgentRoute,
} from '../../services/api/agentRouteSettings.js'
import type { OptionWithDescription } from '../CustomSelect/select.js'
import { Select } from '../CustomSelect/select.js'
import { getSettingsForSource } from '../../utils/settings/settings.js'

type Props = {
  agentType: string
  current: CurrentAgentRoute
  onClose: () => void
}

export function AgentRouteSelector({ agentType, current, onClose }: Props): React.ReactNode {
  const [error, setError] = useState<string | null>(null)

  const apply = (run: () => { error: Error | null }): void => {
    const { error: writeError } = run()
    if (writeError) {
      setError(writeError.message)
      return
    }
    onClose()
  }

  // Build options from the same scope we persist to (user settings), so a key
  // shown here can never create a shadow agentModels entry on a different scope.
  const settings = getSettingsForSource('userSettings')
  const options: OptionWithDescription<string>[] = [
    ...buildRouteOptions(settings, current),
    {
      type: 'input',
      value: CUSTOM_MODEL_VALUE,
      label: 'Enter a custom model id',
      placeholder: 'e.g. gpt-5-mini',
      onChange: (value: string) => {
        const id = value.trim()
        if (id.length === 0) return
        apply(() => setAgentRoute(agentType, id))
      },
    },
  ]

  const onChange = (value: string): void => {
    if (value === CUSTOM_MODEL_VALUE) return
    if (value === CLEAR_ROUTE_VALUE) {
      apply(() => clearAgentRoute(agentType))
      return
    }
    apply(() => setAgentRoute(agentType, value))
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        Set model route for <Text bold>{agentType}</Text> (saved to your user settings, applies next time this agent runs):
      </Text>
      <Select
        options={options}
        defaultValue={currentRouteValue(current)}
        onChange={onChange}
        onCancel={onClose}
      />
      {error && <Text color="error">Could not save: {error}</Text>}
    </Box>
  )
}
