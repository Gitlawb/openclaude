/**
 * SendUserFileTool — deliver files to the user.
 *
 * Follows the same pattern as BriefTool: validates paths, resolves stats,
 * uploads via the shared attachments.ts pipeline (which routes to the
 * local bridge server's /api/oauth/file_upload endpoint).
 *
 * Key difference from BriefTool: files are the primary payload, message is
 * optional. In brief-mode message filtering (Messages.tsx), assistant text
 * is kept for SendUserFile turns (the file IS the content).
 */

import React from 'react'
import { z } from 'zod/v4'
import { getKairosActive } from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { plural } from '../../utils/stringUtils.js'
import {
  resolveAttachments,
  validateAttachmentPaths,
} from '../BriefTool/attachments.js'
import {
  DESCRIPTION,
  SEND_USER_FILE_TOOL_NAME,
  SEND_USER_FILE_TOOL_PROMPT,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    files: z
      .array(z.string())
      .min(1)
      .describe(
        'File paths (absolute or relative to cwd) to send to the user.',
      ),
    message: z
      .string()
      .optional()
      .describe(
        'Optional message explaining what the files are or how to use them.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    files: z
      .array(
        z.object({
          path: z.string(),
          size: z.number(),
          isImage: z.boolean(),
          file_uuid: z.string().optional(),
        }),
      )
      .describe('Resolved file metadata with optional upload UUIDs'),
    message: z.string().optional(),
    sentAt: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const SendUserFileTool = buildTool({
  name: SEND_USER_FILE_TOOL_NAME,
  searchHint: 'send files to the user',
  maxResultSizeChars: 10_000,

  userFacingName() {
    return 'SendUserFile'
  },

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  get outputSchema(): OutputSchema {
    return outputSchema()
  },

  isEnabled() {
    return getKairosActive()
  },

  isConcurrencySafe() {
    return true
  },

  isReadOnly() {
    return true
  },

  toAutoClassifierInput(input) {
    return input.files.join(', ')
  },

  async validateInput({ files }) {
    return validateAttachmentPaths(files)
  },

  async description() {
    return DESCRIPTION
  },

  async prompt() {
    return SEND_USER_FILE_TOOL_PROMPT
  },

  async checkPermissions(input) {
    return { behavior: 'allow' as const, updatedInput: input }
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const n = output.files?.length ?? 0
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${n} ${plural(n, 'file')} delivered to user.${output.message ? ` Message: ${output.message}` : ''}`,
    }
  },

  renderToolUseMessage(
    input: Partial<z.infer<InputSchema>>,
  ): React.ReactNode {
    const files = input.files ?? []
    const msg = input.message ?? ''
    return React.createElement(
      'div',
      null,
      `SendUserFile: ${files.join(', ')}${msg ? ` — ${msg}` : ''}`,
    )
  },

  renderToolResultMessage(
    output: Output,
  ): React.ReactNode {
    const n = output.files?.length ?? 0
    return React.createElement(
      'div',
      null,
      `${n} ${plural(n, 'file')} sent${output.message ? `: ${output.message}` : ''}`,
    )
  },

  async call({ files, message }, context) {
    const sentAt = new Date().toISOString()
    const appState = context.getAppState()
    const resolved = await resolveAttachments(files, {
      replBridgeEnabled: appState.replBridgeEnabled,
      signal: context.abortController.signal,
    })
    return {
      data: { files: resolved, message, sentAt },
    }
  },
} satisfies ToolDef<InputSchema, Output>)
