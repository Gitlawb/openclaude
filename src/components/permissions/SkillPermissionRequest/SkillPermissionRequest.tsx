import React, { useMemo } from 'react'
import { useAppState } from 'src/state/AppState.js'
import { logError } from 'src/utils/log.js'
import { getOriginalCwd } from '../../../bootstrap/state.js'
import { Box, Text } from '../../../ink.js'
import { SKILL_TOOL_NAME } from '../../../tools/SkillTool/constants.js'
import { SkillTool } from '../../../tools/SkillTool/SkillTool.js'
import { shouldShowAlwaysAllowOptions } from '../../../utils/permissions/permissionsLoader.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
} from '../PermissionPrompt.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import {
  createSimplePermissionHandlers,
} from '../simplePermissionActions.js'

type SkillOptionValue =
  | 'yes'
  | 'yes-exact'
  | 'yes-prefix'
  | 'yes-full-access'
  | 'no'

export function SkillPermissionRequest({
  toolUseConfirm,
  onDone,
  onReject,
  workerBadge,
}: PermissionRequestProps) {
  const isDangerousModeAvailable = useAppState(
    s => s.toolPermissionContext.isBypassPermissionsModeAvailable,
  )

  const skill = parseSkillInput(toolUseConfirm.input)
  const commandObj =
    toolUseConfirm.permissionResult.behavior === 'ask' &&
    toolUseConfirm.permissionResult.metadata &&
    'command' in toolUseConfirm.permissionResult.metadata
      ? toolUseConfirm.permissionResult.metadata.command
      : undefined

  const { onSelect, onCancel } = createSimplePermissionHandlers(
    toolUseConfirm,
    { onDone, onReject },
    {
      yes: {
        behavior: 'allow',
        includeFeedback: true,
      },
      'yes-exact': {
        behavior: 'allow',
        updates: [
          {
            type: 'addRules',
            rules: [{ toolName: SKILL_TOOL_NAME, ruleContent: skill }],
            behavior: 'allow',
            destination: 'localSettings',
          },
        ],
      },
      'yes-prefix': () => {
        const spaceIndex = skill.indexOf(' ')
        const commandPrefix =
          spaceIndex > 0 ? skill.substring(0, spaceIndex) : skill
        return {
          behavior: 'allow' as const,
          updates: [
            {
              type: 'addRules',
              rules: [
                {
                  toolName: SKILL_TOOL_NAME,
                  ruleContent: `${commandPrefix}:*`,
                },
              ],
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
        includeFeedback: true,
      },
    },
  )

  const options = useMemo(() => {
    const nextOptions: PermissionPromptOption<SkillOptionValue>[] = [
      {
        label: 'Yes',
        value: 'yes',
        feedbackConfig: { type: 'accept' },
      },
    ]

    if (shouldShowAlwaysAllowOptions()) {
      nextOptions.push({
        label: (
          <Text>
            Yes, and don&apos;t ask again for <Text bold>{skill}</Text> in{' '}
            <Text bold>{getOriginalCwd()}</Text>
          </Text>
        ),
        value: 'yes-exact',
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

      const spaceIndex = skill.indexOf(' ')
      if (spaceIndex > 0) {
        const commandPrefix = `${skill.substring(0, spaceIndex)}:*`
        nextOptions.push({
          label: (
            <Text>
              Yes, and don&apos;t ask again for <Text bold>{commandPrefix}</Text>{' '}
              commands in <Text bold>{getOriginalCwd()}</Text>
            </Text>
          ),
          value: 'yes-prefix',
        })
      }
    }

    nextOptions.push({
      label: 'No',
      value: 'no',
      feedbackConfig: { type: 'reject' },
    })

    return nextOptions
  }, [isDangerousModeAvailable, skill])

  return (
    <PermissionPrompt
      toolUseConfirm={toolUseConfirm}
      workerBadge={workerBadge}
      title={`Use skill "${skill}"?`}
      header={
        <>
          <Text>Claude may use instructions, code, or files from this Skill.</Text>
          {commandObj?.description ? (
            <Box flexDirection="column" paddingX={2} paddingY={1}>
              <Text dimColor>{commandObj.description}</Text>
            </Box>
          ) : null}
        </>
      }
      options={options}
      onSelect={onSelect}
      onCancel={onCancel}
    />
  )
}

function parseSkillInput(input: unknown): string {
  const result = SkillTool.inputSchema.safeParse(input)

  if (!result.success) {
    logError(new Error(`Failed to parse skill tool input: ${result.error.message}`))
    return ''
  }

  return result.data.skill
}
