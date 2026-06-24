import * as React from 'react'
import { useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import {
  CUSTOM_MODEL_VALUE,
  CLEAR_ROUTE_VALUE,
  buildRouteOptions,
  clearAgentRoute,
  currentRouteValue,
  getRouteShadowSource,
  getShadowedModelKeys,
  setAgentRoute,
  shadowRemediation,
  type CurrentAgentRoute,
} from '../../services/api/agentRouteSettings.js'
import type { OptionWithDescription } from '../CustomSelect/select.js'
import { Select } from '../CustomSelect/select.js'
import { getInitialSettings, getSettingsForSource } from '../../utils/settings/settings.js'

type Props = {
  agentType: string
  current: CurrentAgentRoute
  onClose: () => void
}

export function AgentRouteSelector({ agentType, current, onClose }: Props): React.ReactNode {
  const [error, setError] = useState<string | null>(null)
  // The input option's onChange fires on every keystroke; track the value here
  // and only persist on submit (handled below via the sentinel), so typing
  // "gpt-5-mini" saves the full id instead of "g" on the first character.
  const customIdRef = useRef('')

  const apply = (run: () => { error: Error | null }): void => {
    const { error: writeError } = run()
    if (writeError) {
      setError(writeError.message)
      return
    }
    onClose()
  }

  // A higher-priority settings source (project/local/policy) can override the
  // user file the picker writes to. Saving there would be a silent no-op, so
  // explain it as read-only instead of offering an ineffective edit.
  const shadowSource = getRouteShadowSource(agentType)
  if (shadowSource) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          <Text bold>{agentType}</Text> is routed by <Text bold>{shadowSource}</Text> settings, which override your user settings.
        </Text>
        <Text dimColor>
          A user-level change won't take effect. {shadowRemediation(shadowSource)} Press Esc to go back.
        </Text>
        <Select
          options={[{ value: '__back__', label: 'Back' }]}
          onChange={onClose}
          onCancel={onClose}
        />
      </Box>
    )
  }

  // Options are built from userSettings (the scope we persist to), but a key
  // here can still collide with a higher-priority agentModels entry that wins on
  // merge, so flag those as shadowed. A `default` route also changes what
  // clearing means, so surface that in the clear label.
  const settings = getSettingsForSource('userSettings')
  const options: OptionWithDescription<string>[] = [
    ...buildRouteOptions(settings, current, {
      shadowedModelKeys: getShadowedModelKeys(),
      defaultRouteApplies: Boolean(getInitialSettings()?.agentRouting?.default),
    }),
    {
      type: 'input',
      value: CUSTOM_MODEL_VALUE,
      label: 'Enter a custom model id',
      placeholder: 'e.g. gpt-5-mini',
      onChange: (value: string) => {
        customIdRef.current = value
      },
    },
  ]

  const onChange = (value: string): void => {
    if (value === CUSTOM_MODEL_VALUE) {
      const id = customIdRef.current.trim()
      if (id.length === 0) {
        onClose()
        return
      }
      apply(() => setAgentRoute(agentType, id))
      return
    }
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
