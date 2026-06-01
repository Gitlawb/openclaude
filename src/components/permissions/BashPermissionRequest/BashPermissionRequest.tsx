import { c as _c } from 'react-compiler-runtime'
import { feature } from 'bun:bundle'
import figures from 'figures'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useTheme } from '../../../ink.js'
import { useKeybinding } from '../../../keybindings/useKeybinding.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../../services/analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js'
import { useAppState } from '../../../state/AppState.js'
import { BashTool } from '../../../tools/BashTool/BashTool.js'
import {
  getFirstWordPrefix,
  getSimpleCommandPrefix,
} from '../../../tools/BashTool/bashPermissions.js'
import { getDestructiveCommandWarning } from '../../../tools/BashTool/destructiveCommandWarning.js'
import { parseSedEditCommand } from '../../../tools/BashTool/sedEditParser.js'
import { BASH_TOOL_NAME } from '../../../tools/BashTool/toolName.js'
import { shouldUseSandbox } from '../../../tools/BashTool/shouldUseSandbox.js'
import { extractOutputRedirections } from '../../../utils/bash/commands.js'
import { getCompoundCommandPrefixesStatic } from '../../../utils/bash/prefix.js'
import { extractRules } from '../../../utils/permissions/PermissionUpdate.js'
import { SandboxManager } from '../../../utils/sandbox/sandbox-adapter.js'
import { ShimmerChar } from '../../Spinner/ShimmerChar.js'
import { useShimmerAnimation } from '../../Spinner/useShimmerAnimation.js'
import {
  type BaseShellToolUseOption,
  buildBaseShellToolUseOptions,
  handleBaseShellSelection,
} from '../baseShellToolUseOptions.js'
import { usePermissionExplainerUI } from '../PermissionExplanation.js'
import type { PermissionRequestProps } from '../PermissionRequest.js'
import { SedEditPermissionRequest } from '../SedEditPermissionRequest/SedEditPermissionRequest.js'
import { SharedShellPermissionRequest } from '../SharedShellPermissionRequest.js'
import { useDangerousModeConfirmation } from '../useDangerousModeConfirmation.js'
import { useShellPermissionFeedback } from '../useShellPermissionFeedback.js'

const CHECKING_TEXT = 'Attempting to auto-approve...'

function stripBashRedirections(command: string): string {
  const { commandWithoutRedirections, redirections } =
    extractOutputRedirections(command)
  return redirections.length > 0 ? commandWithoutRedirections : command
}

function ClassifierCheckingSubtitle() {
  const $ = _c(6)
  const [ref, glimmerIndex] = useShimmerAnimation(
    'requesting',
    CHECKING_TEXT,
    false,
  )
  let chars
  if ($[0] === Symbol.for('react.memo_cache_sentinel')) {
    chars = [...CHECKING_TEXT]
    $[0] = chars
  } else {
    chars = $[0]
  }
  let text
  if ($[1] !== glimmerIndex) {
    text = (
      <Text>
        {chars.map((char, index) => (
          <ShimmerChar
            key={index}
            char={char}
            index={index}
            glimmerIndex={glimmerIndex}
            messageColor="inactive"
            shimmerColor="subtle"
          />
        ))}
      </Text>
    )
    $[1] = glimmerIndex
    $[2] = text
  } else {
    text = $[2]
  }
  let box
  if ($[3] !== ref || $[4] !== text) {
    box = <Box ref={ref}>{text}</Box>
    $[3] = ref
    $[4] = text
    $[5] = box
  } else {
    box = $[5]
  }
  return box
}

export function BashPermissionRequest(props: PermissionRequestProps) {
  const { toolUseConfirm, toolUseContext, onDone, onReject, verbose, workerBadge } =
    props
  const { command, description } = BashTool.inputSchema.parse(
    toolUseConfirm.input,
  )
  const sedInfo = parseSedEditCommand(command)

  if (sedInfo) {
    return (
      <SedEditPermissionRequest
        toolUseConfirm={toolUseConfirm}
        toolUseContext={toolUseContext}
        onDone={onDone}
        onReject={onReject}
        verbose={verbose}
        workerBadge={workerBadge}
        sedInfo={sedInfo}
      />
    )
  }

  return (
    <BashPermissionRequestInner
      toolUseConfirm={toolUseConfirm}
      toolUseContext={toolUseContext}
      onDone={onDone}
      onReject={onReject}
      verbose={verbose}
      workerBadge={workerBadge}
      command={command}
      description={description}
    />
  )
}

function BashPermissionRequestInner({
  toolUseConfirm,
  toolUseContext,
  onDone,
  onReject,
  verbose: _verbose,
  workerBadge,
  command,
  description,
}: PermissionRequestProps & {
  command: string
  description?: string
}): React.ReactNode {
  const [theme] = useTheme()
  const toolPermissionContext = useAppState(s => s.toolPermissionContext)
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
  const { confirmDangerousMode, dangerousModeDialog } =
    useDangerousModeConfirmation()

  const isCompound =
    toolUseConfirm.permissionResult.decisionReason?.type ===
    'subcommandResults'

  const [editablePrefix, setEditablePrefix] = useState<string | undefined>(() => {
    if (isCompound) {
      const backendBashRules = extractRules(
        'suggestions' in toolUseConfirm.permissionResult
          ? toolUseConfirm.permissionResult.suggestions
          : undefined,
      ).filter(rule => rule.toolName === BashTool.name && rule.ruleContent)
      return backendBashRules.length === 1
        ? backendBashRules[0]!.ruleContent
        : undefined
    }

    const twoWordPrefix = getSimpleCommandPrefix(command)
    if (twoWordPrefix) return `${twoWordPrefix}:*`

    const oneWordPrefix = getFirstWordPrefix(command)
    if (oneWordPrefix) return `${oneWordPrefix}:*`

    return command
  })
  const hasUserEditedPrefix = useRef(false)
  const onEditablePrefixChange = useCallback((value: string) => {
    hasUserEditedPrefix.current = true
    setEditablePrefix(value)
  }, [])

  useEffect(() => {
    if (isCompound) return
    let cancelled = false
    getCompoundCommandPrefixesStatic(command, subcommand =>
      BashTool.isReadOnly({ command: subcommand }),
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
  }, [command, isCompound])

  const [classifierWasChecking] = useState(
    feature('BASH_CLASSIFIER')
      ? !!toolUseConfirm.classifierCheckInProgress
      : false,
  )

  const { destructiveWarning, sandboxingEnabled, isSandboxed } = useMemo(() => {
    const warning = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_destructive_command_warning',
      false,
    )
      ? getDestructiveCommandWarning(command)
      : null
    const sandboxingIsEnabled = SandboxManager.isSandboxingEnabled()
    const sandboxed =
      sandboxingIsEnabled && shouldUseSandbox(toolUseConfirm.input)
    return {
      destructiveWarning: warning,
      sandboxingEnabled: sandboxingIsEnabled,
      isSandboxed: sandboxed,
    }
  }, [command, toolUseConfirm.input])

  const options = useMemo(
    () =>
      buildBaseShellToolUseOptions<BaseShellToolUseOption>({
        suggestions:
          toolUseConfirm.permissionResult.behavior === 'ask'
            ? toolUseConfirm.permissionResult.suggestions
            : undefined,
        shellToolName: BASH_TOOL_NAME,
        prefixPlaceholder: 'command prefix (e.g., npm run:*)',
        onRejectFeedbackChange: setRejectFeedback,
        onAcceptFeedbackChange: setAcceptFeedback,
        yesInputMode,
        noInputMode,
        isDangerousModeAvailable:
          toolPermissionContext.isBypassPermissionsModeAvailable,
        editablePrefix,
        onEditablePrefixChange,
        commandTransform: stripBashRedirections,
      }),
    [
      toolUseConfirm.permissionResult,
      setRejectFeedback,
      setAcceptFeedback,
      yesInputMode,
      noInputMode,
      toolPermissionContext.isBypassPermissionsModeAvailable,
      editablePrefix,
      onEditablePrefixChange,
    ],
  )

  const handleDismissCheckmark = useCallback(() => {
    toolUseConfirm.onDismissCheckmark?.()
  }, [toolUseConfirm])

  useKeybinding('confirm:no', handleDismissCheckmark, {
    context: 'Confirmation',
    isActive: feature('BASH_CLASSIFIER')
      ? !!toolUseConfirm.classifierAutoApproved
      : false,
  })

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
      ruleToolName: BashTool.name,
      toolAnalyticsName: toolNameForAnalytics,
      confirmFullAccess: onConfirm => {
        confirmDangerousMode('fullAccess', onConfirm)
      },
    })
  }

  if (dangerousModeDialog) {
    return dangerousModeDialog
  }

  const classifierSubtitle = feature('BASH_CLASSIFIER')
    ? toolUseConfirm.classifierAutoApproved
      ? (
          <Text>
            <Text color="success">{figures.tick} Auto-approved</Text>
            {toolUseConfirm.classifierMatchedRule ? (
              <Text dimColor>{` | matched "${toolUseConfirm.classifierMatchedRule}"`}</Text>
            ) : null}
          </Text>
        )
      : toolUseConfirm.classifierCheckInProgress
        ? <ClassifierCheckingSubtitle />
        : classifierWasChecking
          ? <Text dimColor>Requires manual approval</Text>
          : undefined
    : undefined

  const classifierAutoApproved = feature('BASH_CLASSIFIER')
    ? !!toolUseConfirm.classifierAutoApproved
    : false

  return (
    <SharedShellPermissionRequest
      toolUseConfirm={toolUseConfirm}
      toolUseContext={toolUseContext}
      workerBadge={workerBadge}
      title={
        sandboxingEnabled && !isSandboxed
          ? 'Bash command (unsandboxed)'
          : 'Bash command'
      }
      subtitle={classifierSubtitle}
      toolName="Bash"
      message={BashTool.renderToolUseMessage(
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
      isContentDimmed={classifierAutoApproved}
      isSelectDisabled={classifierAutoApproved}
    />
  )
}
