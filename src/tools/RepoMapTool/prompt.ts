export const REPO_MAP_TOOL_NAME = 'RepoMap'

export function getDescription(): string {
  return `Build a structural map of the repository showing ranked files and their key signatures (functions, classes, types, interfaces).

## When to use
- At the start of a session on an unfamiliar repository to understand the codebase architecture
- Before cross-file refactors to identify which files are structurally connected
- When searching for where a concept or feature lives across the codebase
- When the user asks "how is this repo organized" or "what are the important files"

## When NOT to use
- To read the contents of a specific file — use Read instead
- To search for exact text or patterns — use Grep instead
- To find files by name or glob pattern — use Glob instead
- When you already know which files to examine

## How it works
The tool parses every supported source file (TypeScript, JavaScript, Python) using tree-sitter, extracts symbol definitions and references, builds a cross-file reference graph weighted by symbol importance (IDF), and ranks files using PageRank. The output is a token-budgeted summary showing the highest-ranked files with their key signatures (function/class/type declarations).

## Parameters
- **max_tokens**: Controls how many files fit in the output. Use 1024 for a quick overview, 4096+ for comprehensive maps. Default: 1024.
- **focus_files**: Pass relative paths (e.g. \`["src/tools/"]\`) to boost specific files and their neighbors in the ranking. Use when the user mentions specific directories or files.
- **focus_symbols**: Pass symbol names (e.g. \`["buildTool", "ToolUseContext"]\`) to boost files that define those symbols. Use when the user asks about specific functions or types.

## Important notes
- The map shows **signatures only**, not function bodies. Use Read to see implementations.
- Results are **auto-cached** on disk — repeat calls with the same parameters return instantly.
- Files are ranked by structural importance: files imported by many others rank highest.
`
}
