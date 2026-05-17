import React from 'react'
import { useAppState } from 'src/state/AppState.js'
import { getOriginalCwd } from '../../../bootstrap/state.js'
import { Box, Text } from '../../../ink.js'
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
} from '../PermissionPrompt.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import {
  createSimplePermissionHandlers,
} from '../simplePermissionActions.js'

type OptionValue = 'yes' | 'yes-dont-ask-again' | 'yes-full-access' | 'no'

export function MonitorPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps) {
  const isDangerousModeAvailable = useAppState(
    s => s.toolPermissionContext.isBypassPermissionsModeAvailable,
  )
  const { command, description } = toolUseConfirm.input as {
    command?: string
    description?: string
  }

  const { onSelect, onCancel } = createSimplePermissionHandlers(
    toolUseConfirm,
    { onDone, onReject },
    {
      yes: {
        behavior: 'allow',
        includeFeedback: true,
      },
      'yes-dont-ask-again': () => {
        // Save the rule under 'Bash' toolName because checkPermissions
        // delegates to bashToolHasPermission which matches rules against
        // BashTool. Using 'Monitor' here would create a rule that's never
        // checked. Command-specific prefix (like BashTool's shellRuleMatching).
        const cmdForRule = command?.trim() || ''
        const prefix = cmdForRule.split(/\s+/).slice(0, 2).join(' ')
        return {
          behavior: 'allow' as const,
          updates: prefix
            ? [
                {
                  type: 'addRules',
                  rules: [{ toolName: 'Bash', ruleContent: `${prefix}:*` }],
                  behavior: 'allow',
                  destination: 'localSettings',
                },
              ]
            : [],
        }
      },
      'yes-full-access': {
        behavior: 'allow',
        updates: [
          {
            type: 'setMode',
            mode: 'fullAccess',
            destination: 'session',
          },
        ],
      },
      no: {
        behavior: 'reject',
        includeFeedback: true,
      },
    },
  )

  const showAlwaysAllow = shouldShowAlwaysAllowOptions()
  const originalCwd = getOriginalCwd()

  const options: PermissionPromptOption<OptionValue>[] = [
    {
      label: 'Yes',
      value: 'yes',
      feedbackConfig: { type: 'accept' },
    },
  ]

  if (showAlwaysAllow) {
    options.push({
      label: (
        <Text>
          Yes, and don&apos;t ask again for{' '}
          <Text bold>Monitor</Text> commands in{' '}
          <Text bold>{originalCwd}</Text>
        </Text>
      ),
      value: 'yes-dont-ask-again',
    })
    if (isDangerousModeAvailable) {
      options.push({
        label: (
          <Text color="error">
            Yes, and enable Full Access for this session
          </Text>
        ),
        value: 'yes-full-access',
        dangerousMode: 'fullAccess',
      })
    }
  }

  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  })

  return (
    <PermissionPrompt
      toolUseConfirm={toolUseConfirm}
      workerBadge={workerBadge}
      title="Monitor"
      header={
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text>
            Monitor({command ?? ''})
          </Text>
          {description ? (
            <Text dimColor>{description}</Text>
          ) : null}
        </Box>
      }
      options={options}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  )
}
