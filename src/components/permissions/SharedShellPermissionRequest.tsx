import React, { useCallback, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { OptionWithDescription } from '../CustomSelect/select.js'
import { Select } from '../CustomSelect/select.js'
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js'
import { PermissionDecisionDebugInfo } from './PermissionDecisionDebugInfo.js'
import { PermissionExplainerContent } from './PermissionExplanation.js'
import { PermissionScaffold } from './PermissionScaffold.js'
import type { PermissionRequestProps, ToolUseConfirm } from './PermissionRequest.js'

type ExplainerState = {
  visible: boolean
  enabled: boolean
  promise: React.ComponentProps<typeof PermissionExplainerContent>['promise']
}

const DEFAULT_UNARY_EVENT: UnaryEvent = {
  completion_type: 'tool_use_single',
  language_name: 'none',
}

type SharedShellPermissionRequestProps<T extends string> = Pick<
  PermissionRequestProps,
  'toolUseContext' | 'workerBadge'
> & {
  toolUseConfirm: ToolUseConfirm
  title: string
  subtitle?: React.ReactNode
  toolName: string
  message: React.ReactNode
  description?: string
  explainerState: ExplainerState
  destructiveWarning?: string | null
  question?: string
  options: OptionWithDescription<T>[]
  onSelect: (value: T) => void
  onCancel: () => void
  onFocus: (value: T) => void
  onInputModeToggle: (value: T) => void
  focusedOption: string
  yesInputMode: boolean
  noInputMode: boolean
  isContentDimmed?: boolean
  isSelectDisabled?: boolean
}

export function SharedShellPermissionRequest<T extends string>({
  toolUseConfirm,
  toolUseContext,
  workerBadge,
  title,
  subtitle,
  toolName,
  message,
  description,
  explainerState,
  destructiveWarning,
  question = 'Do you want to proceed?',
  options,
  onSelect,
  onCancel,
  onFocus,
  onInputModeToggle,
  focusedOption,
  yesInputMode,
  noInputMode,
  isContentDimmed = false,
  isSelectDisabled = false,
}: SharedShellPermissionRequestProps<T>) {
  usePermissionRequestLogging(toolUseConfirm, DEFAULT_UNARY_EVENT)

  const [showPermissionDebug, setShowPermissionDebug] = useState(false)

  const handleToggleDebug = useCallback(() => {
    setShowPermissionDebug(prev => !prev)
  }, [])

  useKeybinding('permission:toggleDebug', handleToggleDebug, {
    context: 'Confirmation',
  })

  const displayedOptions = isSelectDisabled
    ? options.map(option => ({ ...option, disabled: true }))
    : options

  return (
    <PermissionScaffold
      workerBadge={workerBadge}
      title={title}
      subtitle={subtitle}
      header={
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text dimColor={explainerState.visible || isContentDimmed}>{message}</Text>
          {!explainerState.visible && description ? (
            <Text dimColor>{description}</Text>
          ) : null}
          <PermissionExplainerContent
            visible={explainerState.visible}
            promise={explainerState.promise}
          />
        </Box>
      }
      permissionResult={toolUseConfirm.permissionResult}
      toolType="command"
      showRuleExplanation={!showPermissionDebug}
    >
      {showPermissionDebug ? (
        <>
          <PermissionDecisionDebugInfo
            permissionResult={toolUseConfirm.permissionResult}
            toolName={toolName}
          />
          {toolUseContext.options.debug ? (
            <Box justifyContent="flex-end" marginTop={1}>
              <Text dimColor>Ctrl-D to hide debug info</Text>
            </Box>
          ) : null}
        </>
      ) : (
        <>
          <Box flexDirection="column">
            {destructiveWarning ? (
              <Box marginBottom={1}>
                <Text color="warning" dimColor={isContentDimmed}>
                  {destructiveWarning}
                </Text>
              </Box>
            ) : null}
            <Text dimColor={isContentDimmed}>{question}</Text>
            <Select
              options={displayedOptions}
              isDisabled={isSelectDisabled}
              inlineDescriptions
              onChange={onSelect}
              onCancel={onCancel}
              onFocus={onFocus}
              onInputModeToggle={onInputModeToggle}
            />
          </Box>
          <Box justifyContent="space-between" marginTop={1}>
            <Text dimColor>
              Esc to cancel
              {((focusedOption === 'yes' && !yesInputMode) ||
                (focusedOption === 'no' && !noInputMode)) &&
                ' | Tab to amend'}
              {explainerState.enabled &&
                ` | ctrl+e to ${explainerState.visible ? 'hide' : 'explain'}`}
            </Text>
            {toolUseContext.options.debug ? (
              <Text dimColor>Ctrl+d to show debug info</Text>
            ) : null}
          </Box>
        </>
      )}
    </PermissionScaffold>
  )
}
