import React, { useMemo } from 'react'
import { useAppState } from 'src/state/AppState.js'
import { Box, Text, useTheme } from '../../../ink.js'
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
} from '../PermissionPrompt.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import {
  createSimplePermissionHandlers,
} from '../simplePermissionActions.js'
import { WebFetchTool } from '../../../tools/WebFetchTool/WebFetchTool.js'

type WebFetchOptionValue = 'yes' | 'yes-dont-ask-again-domain' | 'yes-full-access' | 'no'

function inputToPermissionRuleContent(input: { [k: string]: unknown }): string {
  try {
    const parsedInput = WebFetchTool.inputSchema.safeParse(input)
    if (!parsedInput.success) {
      return `input:${input.toString()}`
    }

    const hostname = new URL(parsedInput.data.url).hostname
    return `domain:${hostname}`
  } catch {
    return `input:${input.toString()}`
  }
}

export function WebFetchPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  verbose,
  workerBadge,
}: PermissionRequestProps) {
  const [theme] = useTheme()
  const isDangerousModeAvailable = useAppState(
    s => s.toolPermissionContext.isBypassPermissionsModeAvailable,
  )

  const { url } = toolUseConfirm.input as { url: string }
  const hostname = new URL(url).hostname

  const options = useMemo(() => {
    const nextOptions: PermissionPromptOption<WebFetchOptionValue>[] = [
      {
        label: 'Yes',
        value: 'yes',
      },
    ]

    if (shouldShowAlwaysAllowOptions()) {
      nextOptions.push({
        label: <Text>Yes, and don&apos;t ask again for <Text bold>{hostname}</Text></Text>,
        value: 'yes-dont-ask-again-domain',
      })

      if (isDangerousModeAvailable) {
        nextOptions.push({
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

    nextOptions.push({
      label: 'No',
      value: 'no',
    })

    return nextOptions
  }, [hostname, isDangerousModeAvailable])

  const { onSelect, onCancel } = createSimplePermissionHandlers(
    toolUseConfirm,
    { onDone, onReject },
    {
      yes: {
        behavior: 'allow',
      },
      'yes-dont-ask-again-domain': () => {
        const ruleContent = inputToPermissionRuleContent(toolUseConfirm.input)
        return {
          behavior: 'allow' as const,
          updates: [
            {
              type: 'addRules',
              rules: [{ toolName: toolUseConfirm.tool.name, ruleContent }],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ],
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
      },
    },
  )

  return (
    <PermissionPrompt
      toolUseConfirm={toolUseConfirm}
      workerBadge={workerBadge}
      title="Fetch"
      header={
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text>
            {WebFetchTool.renderToolUseMessage(
              toolUseConfirm.input as { url: string; prompt: string },
              { theme, verbose },
            )}
          </Text>
          <Text dimColor>{toolUseConfirm.description}</Text>
        </Box>
      }
      question="Do you want to allow Claude to fetch this content?"
      options={options}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  )
}
