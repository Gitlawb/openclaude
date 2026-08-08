import React, { type ReactNode, useMemo, useState } from 'react'
import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js'
import { Box, Text } from '../../ink.js'
import type { KeybindingAction } from '../../keybindings/types.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import { useSetAppState } from '../../state/AppState.js'
import type { DangerousPermissionMode } from '../../utils/permissions/dangerousModePrompt.js'
import { Select } from '../CustomSelect/select.js'
import { type UnaryEvent, usePermissionRequestLogging } from './hooks.js'
import { PermissionScaffold } from './PermissionScaffold.js'
import {
  type PermissionRequestProps,
  type ToolUseConfirm,
} from './PermissionRequest.js'
import { useDangerousModeConfirmation } from './useDangerousModeConfirmation.js'

export type FeedbackType = 'accept' | 'reject'

export type PermissionPromptOption<T extends string> = {
  value: T
  label: ReactNode
  feedbackConfig?: {
    type: FeedbackType
    placeholder?: string
  }
  keybinding?: KeybindingAction
  dangerousMode?: DangerousPermissionMode
}

type PermissionPromptProps<T extends string> = Pick<
  PermissionRequestProps,
  'workerBadge'
> & {
  toolUseConfirm: ToolUseConfirm
  title: string
  header: React.ReactNode
  question?: string | ReactNode
  options: PermissionPromptOption<T>[]
  onSelect: (value: T, feedback?: string) => void
  onCancel?: () => void
  toolType?: 'tool' | 'command' | 'edit' | 'read'
}

const DEFAULT_PLACEHOLDERS: Record<FeedbackType, string> = {
  accept: `tell ${PRODUCT_DISPLAY_NAME} what to do next`,
  reject: `tell ${PRODUCT_DISPLAY_NAME} what to do differently`,
}

const DEFAULT_UNARY_EVENT: UnaryEvent = {
  completion_type: 'tool_use_single',
  language_name: 'none',
}

export function PermissionPrompt<T extends string>({
  toolUseConfirm,
  workerBadge,
  title,
  header,
  options,
  onSelect,
  onCancel,
  question = 'Do you want to proceed?',
  toolType = 'tool',
}: PermissionPromptProps<T>) {
  usePermissionRequestLogging(toolUseConfirm, DEFAULT_UNARY_EVENT)

  const setAppState = useSetAppState()
  const [acceptFeedback, setAcceptFeedback] = useState('')
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [acceptInputMode, setAcceptInputMode] = useState(false)
  const [rejectInputMode, setRejectInputMode] = useState(false)
  const [focusedValue, setFocusedValue] = useState<T | null>(null)
  const [acceptFeedbackModeEntered, setAcceptFeedbackModeEntered] =
    useState(false)
  const [rejectFeedbackModeEntered, setRejectFeedbackModeEntered] =
    useState(false)
  const { confirmDangerousMode, dangerousModeDialog } =
    useDangerousModeConfirmation()

  const toolAnalyticsContext = {
    toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
    isMcp: toolUseConfirm.tool.isMcp ?? false,
  }

  const focusedOption = useMemo(
    () => options.find(option => option.value === focusedValue),
    [focusedValue, options],
  )

  const focusedFeedbackType = focusedOption?.feedbackConfig?.type
  const showTabHint =
    (focusedFeedbackType === 'accept' && !acceptInputMode) ||
    (focusedFeedbackType === 'reject' && !rejectInputMode)

  const selectOptions = useMemo(
    () =>
      options.map(option => {
        if (!option.feedbackConfig) {
          return {
            label: option.label,
            value: option.value,
          }
        }

        const { type, placeholder } = option.feedbackConfig
        const isInputMode = type === 'accept' ? acceptInputMode : rejectInputMode
        const onChange = type === 'accept' ? setAcceptFeedback : setRejectFeedback

        if (!isInputMode) {
          return {
            label: option.label,
            value: option.value,
          }
        }

        return {
          type: 'input' as const,
          label: option.label,
          value: option.value,
          placeholder: placeholder ?? DEFAULT_PLACEHOLDERS[type],
          onChange,
          allowEmptySubmitToCancel: true,
        }
      }),
    [acceptInputMode, options, rejectInputMode],
  )

  const handleInputModeToggle = (value: T) => {
    const option = options.find(candidate => candidate.value === value)
    if (!option?.feedbackConfig) {
      return
    }

    const analyticsProps = {
      toolName:
        toolAnalyticsContext.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolAnalyticsContext.isMcp,
    }

    if (option.feedbackConfig.type === 'accept') {
      if (acceptInputMode) {
        setAcceptInputMode(false)
        logEvent('tengu_accept_feedback_mode_collapsed', analyticsProps)
      } else {
        setAcceptInputMode(true)
        setAcceptFeedbackModeEntered(true)
        logEvent('tengu_accept_feedback_mode_entered', analyticsProps)
      }
      return
    }

    if (rejectInputMode) {
      setRejectInputMode(false)
      logEvent('tengu_reject_feedback_mode_collapsed', analyticsProps)
    } else {
      setRejectInputMode(true)
      setRejectFeedbackModeEntered(true)
      logEvent('tengu_reject_feedback_mode_entered', analyticsProps)
    }
  }

  const handleSelect = (value: T) => {
    const option = options.find(candidate => candidate.value === value)
    if (!option) {
      return
    }

    let feedback: string | undefined

    if (option.feedbackConfig) {
      const rawFeedback =
        option.feedbackConfig.type === 'accept'
          ? acceptFeedback
          : rejectFeedback
      const trimmedFeedback = rawFeedback.trim()

      if (trimmedFeedback) {
        feedback = trimmedFeedback
      }

      const analyticsProps = {
        toolName:
          toolAnalyticsContext.toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: toolAnalyticsContext.isMcp,
        has_instructions: !!trimmedFeedback,
        instructions_length: trimmedFeedback.length,
        entered_feedback_mode:
          option.feedbackConfig.type === 'accept'
            ? acceptFeedbackModeEntered
            : rejectFeedbackModeEntered,
      }

      const runSelection = () => {
        if (option.feedbackConfig?.type === 'accept') {
          logEvent('tengu_accept_submitted', analyticsProps)
        } else {
          logEvent('tengu_reject_submitted', analyticsProps)
        }
        onSelect(value, feedback)
      }

      if (option.dangerousMode) {
        confirmDangerousMode(option.dangerousMode, runSelection)
        return
      }

      runSelection()
      return
    }

    if (option.dangerousMode) {
      confirmDangerousMode(option.dangerousMode, () => onSelect(value))
      return
    }

    onSelect(value)
  }

  const keybindingHandlers = useMemo(() => {
    const handlers: Record<string, () => void> = {}

    for (const option of options) {
      if (option.keybinding) {
        handlers[option.keybinding] = () => handleSelect(option.value)
      }
    }

    return handlers
  }, [options, handleSelect])

  useKeybindings(keybindingHandlers, {
    context: 'Confirmation',
  })

  const handleCancel = () => {
    logEvent('tengu_permission_request_escape', {})
    setAppState(prev => ({
      ...prev,
      attribution: {
        ...prev.attribution,
        escapeCount: prev.attribution.escapeCount + 1,
      },
    }))
    onCancel?.()
  }

  if (dangerousModeDialog) {
    return dangerousModeDialog
  }

  const renderedQuestion =
    typeof question === 'string' ? <Text>{question}</Text> : question

  return (
    <PermissionScaffold
      title={title}
      workerBadge={workerBadge}
      header={<Box flexDirection="column">{header}</Box>}
      permissionResult={toolUseConfirm.permissionResult}
      toolType={toolType}
    >
      <Box flexDirection="column">
        {renderedQuestion}
        <Select
          options={selectOptions}
          inlineDescriptions
          onChange={handleSelect}
          onCancel={handleCancel}
          onFocus={value => {
            const nextOption = options.find(option => option.value === value)

            if (
              nextOption?.feedbackConfig?.type !== 'accept' &&
              acceptInputMode &&
              !acceptFeedback.trim()
            ) {
              setAcceptInputMode(false)
            }

            if (
              nextOption?.feedbackConfig?.type !== 'reject' &&
              rejectInputMode &&
              !rejectFeedback.trim()
            ) {
              setRejectInputMode(false)
            }

            setFocusedValue(value)
          }}
          onInputModeToggle={handleInputModeToggle}
        />
        <Box marginTop={1}>
          <Text dimColor>
            Esc to cancel
            {showTabHint ? ' | Tab to amend' : ''}
          </Text>
        </Box>
      </Box>
    </PermissionScaffold>
  )
}

export type { PermissionPromptProps }
