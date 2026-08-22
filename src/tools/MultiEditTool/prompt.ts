import { isCompactLinePrefixEnabled } from '../../utils/file.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

export function getMultiEditToolDescription(): string {
  const prefixFormat = isCompactLinePrefixEnabled()
    ? 'line number + tab'
    : 'spaces + line number + arrow'
  return `Performs atomic multi-file edits. All edits are resolved and validated in memory before any file is written — if any edit fails validation (file not found, string not found, ambiguous match), NO edits are applied. This prevents partial modifications that could leave the codebase in a broken state.

Usage:
- You must use your \`${FILE_READ_TOOL_NAME}\` tool to read each existing file before editing. This tool will error if you attempt an edit on an existing file that hasn't been read. To create a new file, pass an empty old_string.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match.
- Each edit in the array follows the same rules as the Edit tool: \`old_string\` must be unique in the file unless \`replace_all\` is true.
- Use this tool when you need to make coordinated changes across multiple files that must succeed or fail together.
- The edits are applied in order. Multiple edits to the same file are supported — each subsequent edit sees the result of the previous one.`
}
