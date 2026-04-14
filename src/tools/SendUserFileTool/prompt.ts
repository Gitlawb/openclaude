/**
 * SendUserFileTool prompt constants.
 *
 * Tool name consumed by conversationRecovery.ts, ToolSearchTool/prompt.ts,
 * and Messages.tsx for tool-name matching and message filtering.
 */

export const SEND_USER_FILE_TOOL_NAME = 'SendUserFile'

export const DESCRIPTION =
  'Send one or more files to the user with an optional accompanying message.'

export const SEND_USER_FILE_TOOL_PROMPT = `Send files to the user. Use this when the user needs to receive a file you've created or modified — generated reports, exported data, patches, images, or any artifact they asked for.

The files are uploaded and made available for download. Include a brief message explaining what the files are.

Prefer this over describing file contents in text when the user needs the actual file (not just its content).`
