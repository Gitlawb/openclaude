import { basename, sep } from 'path'
import React, { type ReactNode } from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { Text } from '../../ink.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js'
import { permissionRuleExtractPrefix } from '../../utils/permissions/shellRuleMatching.js'
import type { OptionWithDescription } from '../CustomSelect/select.js'
import type { ToolUseConfirm } from './PermissionRequest.js'
import { logUnaryPermissionEvent } from './utils.js'

export type BaseShellToolUseOption =
  | 'yes'
  | 'yes-apply-suggestions'
  | 'yes-prefix-edited'
  | 'yes-full-access'
  | 'no'

function commandListDisplay(commands: string[]): ReactNode {
  switch (commands.length) {
    case 0:
      return ''
    case 1:
      return <Text bold>{commands[0]}</Text>
    case 2:
      return (
        <Text>
          <Text bold>{commands[0]}</Text> and <Text bold>{commands[1]}</Text>
        </Text>
      )
    default:
      return (
        <Text>
          <Text bold>{commands.slice(0, -1).join(', ')}</Text>, and{' '}
          <Text bold>{commands.slice(-1)[0]}</Text>
        </Text>
      )
  }
}

function commandListDisplayTruncated(commands: string[]): ReactNode {
  if (commands.join(', ').length > 50) {
    return 'similar'
  }

  return commandListDisplay(commands)
}

function formatPathList(paths: string[]): ReactNode {
  if (paths.length === 0) return ''

  const names = paths.map(path => basename(path) || path)
  if (names.length === 1) {
    return (
      <Text>
        <Text bold>{names[0]}</Text>
        {sep}
      </Text>
    )
  }

  if (names.length === 2) {
    return (
      <Text>
        <Text bold>{names[0]}</Text>
        {sep} and <Text bold>{names[1]}</Text>
        {sep}
      </Text>
    )
  }

  return (
    <Text>
      <Text bold>{names[0]}</Text>
      {sep}, <Text bold>{names[1]}</Text>
      {sep} and {paths.length - 2} more
    </Text>
  )
}

function generateShellSuggestionsLabel(
  suggestions: PermissionUpdate[],
  shellToolName: string,
  commandTransform?: (command: string) => string,
): ReactNode | null {
  const allRules = suggestions
    .filter(suggestion => suggestion.type === 'addRules')
    .flatMap(suggestion => suggestion.rules || [])
  const readRules = allRules.filter(rule => rule.toolName === 'Read')
  const shellRules = allRules.filter(rule => rule.toolName === shellToolName)
  const directories = suggestions
    .filter(suggestion => suggestion.type === 'addDirectories')
    .flatMap(suggestion => suggestion.directories || [])
  const readPaths = readRules
    .map(rule => rule.ruleContent?.replace('/**', '') || '')
    .filter(path => path)
  const shellCommands = [
    ...new Set(
      shellRules.flatMap(rule => {
        if (!rule.ruleContent) return []
        const command =
          permissionRuleExtractPrefix(rule.ruleContent) ?? rule.ruleContent
        return commandTransform ? commandTransform(command) : command
      }),
    ),
  ]

  const hasDirectories = directories.length > 0
  const hasReadPaths = readPaths.length > 0
  const hasCommands = shellCommands.length > 0

  if (hasReadPaths && !hasDirectories && !hasCommands) {
    if (readPaths.length === 1) {
      const firstPath = readPaths[0]!
      const dirName = basename(firstPath) || firstPath
      return (
        <Text>
          Yes, allow reading from <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>
      )
    }

    return (
      <Text>
        Yes, allow reading from {formatPathList(readPaths)} from this project
      </Text>
    )
  }

  if (hasDirectories && !hasReadPaths && !hasCommands) {
    if (directories.length === 1) {
      const firstDir = directories[0]!
      const dirName = basename(firstDir) || firstDir
      return (
        <Text>
          Yes, and always allow access to <Text bold>{dirName}</Text>
          {sep} from this project
        </Text>
      )
    }

    return (
      <Text>
        Yes, and always allow access to {formatPathList(directories)} from this
        project
      </Text>
    )
  }

  if (hasCommands && !hasDirectories && !hasReadPaths) {
    return (
      <Text>
        {"Yes, and don't ask again for "}
        {commandListDisplayTruncated(shellCommands)} commands in{' '}
        <Text bold>{getOriginalCwd()}</Text>
      </Text>
    )
  }

  if ((hasDirectories || hasReadPaths) && !hasCommands) {
    const allPaths = [...directories, ...readPaths]
    if (hasDirectories && hasReadPaths) {
      return (
        <Text>
          Yes, and always allow access to {formatPathList(allPaths)} from this
          project
        </Text>
      )
    }
  }

  if ((hasDirectories || hasReadPaths) && hasCommands) {
    const allPaths = [...directories, ...readPaths]
    if (allPaths.length === 1 && shellCommands.length === 1) {
      return (
        <Text>
          Yes, and allow access to {formatPathList(allPaths)} and{' '}
          {commandListDisplayTruncated(shellCommands)} commands
        </Text>
      )
    }

    return (
      <Text>
        Yes, and allow {formatPathList(allPaths)} access and{' '}
        {commandListDisplayTruncated(shellCommands)} commands
      </Text>
    )
  }

  return null
}

export function buildBaseShellToolUseOptions<T extends string>({
  suggestions = [],
  shellToolName,
  prefixPlaceholder,
  onRejectFeedbackChange,
  onAcceptFeedbackChange,
  yesInputMode = false,
  noInputMode = false,
  isDangerousModeAvailable = false,
  editablePrefix,
  onEditablePrefixChange,
  commandTransform,
  extraAllowOptions = [],
}: {
  suggestions?: PermissionUpdate[]
  shellToolName: string
  prefixPlaceholder: string
  onRejectFeedbackChange: (value: string) => void
  onAcceptFeedbackChange: (value: string) => void
  yesInputMode?: boolean
  noInputMode?: boolean
  isDangerousModeAvailable?: boolean
  editablePrefix?: string
  onEditablePrefixChange?: (value: string) => void
  commandTransform?: (command: string) => string
  extraAllowOptions?: OptionWithDescription<T>[]
}): OptionWithDescription<T>[] {
  const options: OptionWithDescription<T>[] = []

  if (yesInputMode) {
    options.push({
      type: 'input',
      label: 'Yes',
      value: 'yes' as T,
      placeholder: 'and tell Claude what to do next',
      onChange: onAcceptFeedbackChange,
      allowEmptySubmitToCancel: true,
    })
  } else {
    options.push({
      label: 'Yes',
      value: 'yes' as T,
    })
  }

  if (shouldShowAlwaysAllowOptions()) {
    const hasNonShellSuggestions = suggestions.some(
      suggestion =>
        suggestion.type === 'addDirectories' ||
        (suggestion.type === 'addRules' &&
          suggestion.rules?.some(rule => rule.toolName !== shellToolName)),
    )

    if (
      editablePrefix !== undefined &&
      onEditablePrefixChange &&
      !hasNonShellSuggestions &&
      suggestions.length > 0
    ) {
      options.push({
        type: 'input',
        label: "Yes, and don't ask again for",
        value: 'yes-prefix-edited' as T,
        placeholder: prefixPlaceholder,
        initialValue: editablePrefix,
        onChange: onEditablePrefixChange,
        allowEmptySubmitToCancel: true,
        showLabelWithValue: true,
        labelValueSeparator: ': ',
        resetCursorOnUpdate: true,
      })
    } else if (suggestions.length > 0) {
      const label = generateShellSuggestionsLabel(
        suggestions,
        shellToolName,
        commandTransform,
      )
      if (label) {
        options.push({
          label,
          value: 'yes-apply-suggestions' as T,
        })
      }
    }

    options.push(...extraAllowOptions)

    const hasPersistentAllowOption = options.some(option => option.value !== 'yes')
    if (hasPersistentAllowOption && isDangerousModeAvailable) {
      options.push({
        label: 'Yes, and enable Full Access for this session',
        color: 'error',
        value: 'yes-full-access' as T,
      })
    }
  }

  if (noInputMode) {
    options.push({
      type: 'input',
      label: 'No',
      value: 'no' as T,
      placeholder: 'and tell Claude what to do differently',
      onChange: onRejectFeedbackChange,
      allowEmptySubmitToCancel: true,
    })
  } else {
    options.push({
      label: 'No',
      value: 'no' as T,
    })
  }

  return options
}

export function handleBaseShellSelection({
  value,
  toolUseConfirm,
  onDone,
  onReject,
  acceptFeedback,
  rejectFeedback,
  yesFeedbackModeEntered,
  noFeedbackModeEntered,
  editablePrefix,
  ruleToolName,
  toolAnalyticsName,
  confirmFullAccess,
}: {
  value: BaseShellToolUseOption
  toolUseConfirm: ToolUseConfirm
  onDone: () => void
  onReject: (feedback?: string) => void
  acceptFeedback: string
  rejectFeedback: string
  yesFeedbackModeEntered: boolean
  noFeedbackModeEntered: boolean
  editablePrefix?: string
  ruleToolName: string
  toolAnalyticsName: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  confirmFullAccess: (onConfirm: () => void) => void
}): void {
  if (value === 'yes-prefix-edited') {
    const trimmedPrefix = (editablePrefix ?? '').trim()
    logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
    if (!trimmedPrefix) {
      toolUseConfirm.onAllow(toolUseConfirm.input, [])
    } else {
      const prefixUpdates: PermissionUpdate[] = [
        {
          type: 'addRules',
          rules: [
            {
              toolName: ruleToolName,
              ruleContent: trimmedPrefix,
            },
          ],
          behavior: 'allow',
          destination: 'localSettings',
        },
      ]
      toolUseConfirm.onAllow(toolUseConfirm.input, prefixUpdates)
    }
    onDone()
    return
  }

  if (value === 'yes-full-access') {
    logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
    confirmFullAccess(() => {
      toolUseConfirm.onAllow(toolUseConfirm.input, [
        {
          type: 'setMode',
          mode: 'fullAccess',
          destination: 'session',
        },
      ])
      onDone()
    })
    return
  }

  switch (value) {
    case 'yes': {
      const trimmedFeedback = acceptFeedback.trim()
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
      logEvent('tengu_accept_submitted', {
        toolName: toolAnalyticsName,
        isMcp: toolUseConfirm.tool.isMcp ?? false,
        has_instructions: !!trimmedFeedback,
        instructions_length: trimmedFeedback.length,
        entered_feedback_mode: yesFeedbackModeEntered,
      })
      toolUseConfirm.onAllow(
        toolUseConfirm.input,
        [],
        trimmedFeedback || undefined,
      )
      onDone()
      return
    }
    case 'yes-apply-suggestions': {
      logUnaryPermissionEvent('tool_use_single', toolUseConfirm, 'accept')
      const permissionUpdates =
        'suggestions' in toolUseConfirm.permissionResult
          ? toolUseConfirm.permissionResult.suggestions || []
          : []
      toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates)
      onDone()
      return
    }
    case 'no': {
      const trimmedFeedback = rejectFeedback.trim()
      logEvent('tengu_reject_submitted', {
        toolName: toolAnalyticsName,
        isMcp: toolUseConfirm.tool.isMcp ?? false,
        has_instructions: !!trimmedFeedback,
        instructions_length: trimmedFeedback.length,
        entered_feedback_mode: noFeedbackModeEntered,
      })
      onReject(trimmedFeedback || undefined)
      return
    }
  }
}
