import React from 'react'
import { getOriginalCwd } from '../../../bootstrap/state.js'
import { Box, Text } from '../../../ink.js'
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js'
import { env } from '../../../utils/env.js'
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js'
import { usePermissionRequestLogging } from '../hooks.js'
import { PermissionDialog } from '../PermissionDialog.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
} from '../PermissionPrompt.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { PermissionRuleExplanation } from '../PermissionRuleExplanation.js'
import { logUnaryPermissionEvent } from '../utils.js'

type OptionValue = 'yes' | 'yes-dont-ask-again' | 'no'

export function MonitorPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps) {
  const { command, description } = toolUseConfirm.input as {
    command?: string
    description?: string
  }

  usePermissionRequestLogging(toolUseConfirm, {
    completion_type: 'tool_use_single',
    language_name: 'none',
  })

  const handleSelect = (
    value: OptionValue,
    feedback?: string,
  ) => {
    switch (value) {
      case 'yes': {
        // @ts-expect-error React Compiler output loses type context
        logUnaryPermissionEvent({
          completion_type: 'tool_use_single',
          event: 'accept',
          metadata: {
            language_name: 'none',
            message_id: toolUseConfirm.assistantMessage.message.id,
            platform: env.platform,
          },
        })
        toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback)
        onDone()
        break
      }
      case 'yes-dont-ask-again': {
        // @ts-expect-error React Compiler output loses type context
        logUnaryPermissionEvent({
          completion_type: 'tool_use_single',
          event: 'accept',
          metadata: {
            language_name: 'none',
            message_id: toolUseConfirm.assistantMessage.message.id,
            platform: env.platform,
          },
        })
        // Save the rule under 'Bash' toolName because checkPermissions
        // delegates to bashToolHasPermission which matches rules against
        // BashTool. Using 'Monitor' here would create a rule that's never
        // checked. Command-specific prefix (like BashTool's shellRuleMatching).
        const cmdForRule = command?.trim() || ''
        const prefix = cmdForRule.split(/\s+/).slice(0, 2).join(' ')
        toolUseConfirm.onAllow(toolUseConfirm.input, prefix ? [
          {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: `${prefix}:*` }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ] : [])
        onDone()
        break
      }
      case 'no': {
        // @ts-expect-error React Compiler output loses type context
        logUnaryPermissionEvent({
          completion_type: 'tool_use_single',
          event: 'reject',
          metadata: {
            language_name: 'none',
            message_id: toolUseConfirm.assistantMessage.message.id,
            platform: env.platform,
          },
        })
        toolUseConfirm.onReject(feedback)
        onReject()
        onDone()
        break
      }
    }
  }

  const handleCancel = () => {
    // @ts-expect-error React Compiler output loses type context
    logUnaryPermissionEvent({
      completion_type: 'tool_use_single',
      event: 'reject',
      metadata: {
        language_name: 'none',
        message_id: toolUseConfirm.assistantMessage.message.id,
        platform: env.platform,
      },
    })
    toolUseConfirm.onReject()
    onReject()
    onDone()
  }

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
  }

  options.push({
    label: 'No',
    value: 'no',
    feedbackConfig: { type: 'reject' },
  })

  const toolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false,
  }

  return (
    <PermissionDialog title="Monitor" workerBadge={workerBadge}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          Monitor({command ?? ''})
        </Text>
        {description ? (
          <Text dimColor>{description}</Text>
        ) : null}
      </Box>
      <Box flexDirection="column">
        <PermissionRuleExplanation
          permissionResult={toolUseConfirm.permissionResult}
          toolType="tool"
        />
        <PermissionPrompt
          options={options}
          onSelect={handleSelect}
          onCancel={handleCancel}
          toolAnalyticsContext={toolAnalyticsContext}
        />
      </Box>
    </PermissionDialog>
  )
}
