import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../../ink.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js'
import { useAppState } from '../../../state/AppState.js'
import { getDestructiveCommandWarning } from '../../../tools/PowerShellTool/destructiveCommandWarning.js'
import { PowerShellTool } from '../../../tools/PowerShellTool/PowerShellTool.js'
import { isAllowlistedCommand } from '../../../tools/PowerShellTool/readOnlyValidation.js'
import { POWERSHELL_TOOL_NAME } from '../../../tools/PowerShellTool/toolName.js'
import { getCompoundCommandPrefixesStatic } from '../../../utils/powershell/staticPrefix.js'
import {
  type BaseShellToolUseOption,
  buildBaseShellToolUseOptions,
  handleBaseShellSelection,
} from '../baseShellToolUseOptions.js'
import { usePermissionExplainerUI } from '../PermissionExplanation.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { SharedShellPermissionRequest } from '../SharedShellPermissionRequest.js'
import { useDangerousModeConfirmation } from '../useDangerousModeConfirmation.js'
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js'

export function PowerShellPermissionRequest(
  props: PermissionRequestProps,
): React.ReactNode {
  const { toolUseConfirm, toolUseContext, onDone, onReject, workerBadge } = props
  const { command, description } = PowerShellTool.inputSchema.parse(
    toolUseConfirm.input,
  )
  const isDangerousModeAvailable = useAppState(
    state => state.toolPermissionContext.isBypassPermissionsModeAvailable,
  )
  const [theme] = useTheme()
  const explainerState = usePermissionExplainerUI({
    toolName: toolUseConfirm.tool.name,
    toolInput: toolUseConfirm.input,
    toolDescription: toolUseConfirm.description,
    messages: toolUseContext.messages,
  })
  const {
    yesInputMode,
    noInputMode,
    yesFeedbackModeEntered,
    noFeedbackModeEntered,
    acceptFeedback,
    rejectFeedback,
    setAcceptFeedback,
    setRejectFeedback,
    focusedOption,
    handleInputModeToggle,
    handleReject,
    handleFocus,
  } = useShellPermissionFeedback({
    toolUseConfirm,
    onDone,
    onReject,
    explainerVisible: explainerState.visible,
  })
  const destructiveWarning = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_destructive_command_warning',
    false,
  )
    ? getDestructiveCommandWarning(command)
    : null
  const { confirmDangerousMode, dangerousModeDialog } =
    useDangerousModeConfirmation()

  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(
    command.includes('\n') ? undefined : command,
  )
  const hasUserEditedPrefix = useRef(false)

  useEffect(() => {
    let cancelled = false
    getCompoundCommandPrefixesStatic(command, element =>
      isAllowlistedCommand(element, element.text),
    )
      .then(prefixes => {
        if (cancelled || hasUserEditedPrefix.current) return
        if (prefixes.length > 0) {
          setEditablePrefix(`${prefixes[0]}:*`)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [command])

  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true
    setEditablePrefix(value)
  }, [])

  const options = useMemo(
    () =>
      buildBaseShellToolUseOptions<BaseShellToolUseOption>({
        suggestions:
          toolUseConfirm.permissionResult.behavior === 'ask'
            ? toolUseConfirm.permissionResult.suggestions
            : undefined,
        shellToolName: POWERSHELL_TOOL_NAME,
        prefixPlaceholder: 'command prefix (e.g., Get-Process:*)',
        onRejectFeedbackChange: setRejectFeedback,
        onAcceptFeedbackChange: setAcceptFeedback,
        yesInputMode,
        noInputMode,
        isDangerousModeAvailable,
        editablePrefix,
        onEditablePrefixChange,
      }),
    [
      toolUseConfirm.permissionResult,
      setRejectFeedback,
      setAcceptFeedback,
      yesInputMode,
      noInputMode,
      isDangerousModeAvailable,
      editablePrefix,
      onEditablePrefixChange,
    ],
  )

  function onSelect(value: BaseShellToolUseOption) {
    const optionIndex: Record<BaseShellToolUseOption, number> = {
      yes: 1,
      'yes-apply-suggestions': 2,
      'yes-prefix-edited': 2,
      'yes-full-access': 3,
      no: 4,
    }
    logEvent('tengu_permission_request_option_selected', {
      option_index: optionIndex[value],
      explainer_visible: explainerState.visible,
    })
    const toolNameForAnalytics =
      sanitizeToolNameForAnalytics(
        toolUseConfirm.tool.name,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS

    handleBaseShellSelection({
      value,
      toolUseConfirm,
      onDone,
      onReject: handleReject,
      acceptFeedback,
      rejectFeedback,
      yesFeedbackModeEntered,
      noFeedbackModeEntered,
      editablePrefix,
      ruleToolName: PowerShellTool.name,
      toolAnalyticsName: toolNameForAnalytics,
      confirmFullAccess: onConfirm => {
        confirmDangerousMode('fullAccess', onConfirm)
      },
    })
  }

  if (dangerousModeDialog) {
    return dangerousModeDialog
  }

  return (
    <SharedShellPermissionRequest
      toolUseConfirm={toolUseConfirm}
      toolUseContext={toolUseContext}
      workerBadge={workerBadge}
      title="PowerShell command"
      toolName="PowerShell"
      message={PowerShellTool.renderToolUseMessage(
        { command, description },
        { theme, verbose: true },
      )}
      description={toolUseConfirm.description}
      explainerState={explainerState}
      destructiveWarning={destructiveWarning}
      options={options}
      onSelect={onSelect}
      onCancel={() => handleReject()}
      onFocus={handleFocus}
      onInputModeToggle={handleInputModeToggle}
      focusedOption={focusedOption}
      yesInputMode={yesInputMode}
      noInputMode={noInputMode}
    />
  )
}
