import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../../services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from '../../../services/analytics/metadata.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import {
  CLAUDE_FOLDER_PERMISSION_PATTERN,
  FILE_EDIT_TOOL_NAME,
  GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN,
} from '../../../tools/FileEditTool/constants.js'
import { env } from '../../../utils/env.js'
import { generateSuggestions } from '../../../utils/permissions/filesystem.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import {
  type CompletionType,
  logUnaryEvent,
} from '../../../utils/unaryLogging.js'
import { executePermissionAction } from '../simplePermissionActions.js'
import type { ToolUseConfirm } from '../PermissionRequest.js'
import type {
  FileOperationType,
  PermissionOption,
} from './permissionOptions.js'

function logPermissionEvent(
  event: 'accept' | 'reject',
  completionType: CompletionType,
  languageName: string | Promise<string>,
  messageId: string,
  hasFeedback?: boolean,
): void {
  void logUnaryEvent({
    completion_type: completionType,
    event,
    metadata: {
      language_name: languageName,
      message_id: messageId,
      platform: env.platform,
      hasFeedback: hasFeedback ?? false,
    },
  })
}

function logSubmissionEvent(
  event: 'accept' | 'reject',
  toolUseConfirm: ToolUseConfirm,
  options?: PermissionHandlerOptions,
): void {
  logEvent(
    event === 'accept' ? 'tengu_accept_submitted' : 'tengu_reject_submitted',
    {
      toolName: sanitizeToolNameForAnalytics(
        toolUseConfirm.tool.name,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolUseConfirm.tool.isMcp ?? false,
      has_instructions: !!options?.feedback,
      instructions_length: options?.feedback?.length ?? 0,
      entered_feedback_mode: options?.enteredFeedbackMode ?? false,
    },
  )
}

function buildSessionPermissionUpdates(
  path: string | null,
  operationType: FileOperationType,
  toolPermissionContext: ToolPermissionContext,
  scope?: 'claude-folder' | 'global-claude-folder',
): PermissionUpdate[] {
  if (scope === 'claude-folder' || scope === 'global-claude-folder') {
    return [
      {
        type: 'addRules',
        rules: [
          {
            toolName: FILE_EDIT_TOOL_NAME,
            ruleContent:
              scope === 'global-claude-folder'
                ? GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN
                : CLAUDE_FOLDER_PERMISSION_PATTERN,
          },
        ],
        behavior: 'allow',
        destination: 'session',
      },
    ]
  }

  return path
    ? generateSuggestions(path, operationType, toolPermissionContext)
    : []
}

export type PermissionHandlerParams = {
  messageId: string
  path: string | null
  toolUseConfirm: ToolUseConfirm
  toolPermissionContext: ToolPermissionContext
  onDone: () => void
  onReject: () => void
  completionType: CompletionType
  languageName: string | Promise<string>
  operationType: FileOperationType
}

export type PermissionHandlerOptions = {
  hasFeedback?: boolean
  feedback?: string
  enteredFeedbackMode?: boolean
  scope?: 'claude-folder' | 'global-claude-folder'
  input?: unknown
}

export function executeFilePermissionAction(
  optionType: PermissionOption['type'],
  params: PermissionHandlerParams,
  options?: PermissionHandlerOptions,
): void {
  const {
    messageId,
    path,
    toolUseConfirm,
    toolPermissionContext,
    onDone,
    onReject,
    completionType,
    languageName,
    operationType,
  } = params

  const isReject = optionType === 'reject'
  logPermissionEvent(
    isReject ? 'reject' : 'accept',
    completionType,
    languageName,
    messageId,
    options?.hasFeedback,
  )
  logSubmissionEvent(isReject ? 'reject' : 'accept', toolUseConfirm, options)

  if (isReject) {
    executePermissionAction(toolUseConfirm, { onDone, onReject }, {
      behavior: 'reject',
      feedback: options?.feedback,
    })
    return
  }

  const updates: PermissionUpdate[] =
    optionType === 'accept-once'
      ? []
      : optionType === 'accept-full-access'
        ? [{ type: 'setMode', mode: 'fullAccess', destination: 'session' }]
        : buildSessionPermissionUpdates(
            path,
            operationType,
            toolPermissionContext,
            options?.scope,
          )

  executePermissionAction(toolUseConfirm, { onDone }, {
    behavior: 'allow',
    input: options?.input,
    updates,
    feedback: optionType === 'accept-once' ? options?.feedback : undefined,
  })
}
