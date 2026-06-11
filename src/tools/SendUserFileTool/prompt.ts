/**
 * Name constant for SendUserFile (KAIROS-gated assistant tool that
 * delivers files from the working directory to the user's device).
 *
 * Kept in its own module so name-only consumers (Messages.tsx rendering,
 * ToolSearchTool prompt, conversation recovery) can reference the tool
 * name without pulling in the tool implementation.
 */

export const SEND_USER_FILE_TOOL_NAME = 'SendUserFile'
