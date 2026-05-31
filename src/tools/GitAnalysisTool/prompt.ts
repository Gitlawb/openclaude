import { GIT_ANALYSIS_TOOL_NAME } from './constants.js'

export function getDescription(): string {
  return `A tool for deep git history analysis.

  Usage:
  - Use ${GIT_ANALYSIS_TOOL_NAME} for git operations beyond simple diff: blame, log search, bisect, commit analysis.
  - Operations:
    - "blame": Show who last modified each line of a file (with optional line range).
    - "log": Search commit history with query, author, date range, and file filters.
    - "diff-range": Show diff between two commits/refs.
    - "show-commit": Show full details of a specific commit (diff, message, author).
  - All results include commit hashes for easy reference.
  - For simple "git diff" of uncommitted changes, use Bash directly.
`
}
