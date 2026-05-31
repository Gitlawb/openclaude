import { CODE_ANALYSIS_TOOL_NAME } from './constants.js'

export function getDescription(): string {
  return `A tool for static code analysis — complexity metrics, dead code detection, and import graph analysis.

  Usage:
  - Use ${CODE_ANALYSIS_TOOL_NAME} to analyze code structure and quality.
  - Operations:
    - "complexity": Calculate cyclomatic complexity for functions in a file.
    - "dead-code": Detect potentially unused exports/functions in a file or directory.
    - "imports": Show import/require dependency graph for a file or directory.
    - "duplicates": Detect duplicate code blocks across files.
    - "size": Show file sizes and line counts for a directory tree.
  - Results include actionable metrics for refactoring decisions.
  - For symbol-level analysis (definitions, references), use the LSP tool instead.
`
}
