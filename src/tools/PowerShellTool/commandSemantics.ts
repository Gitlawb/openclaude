/**
 * Command semantics configuration for interpreting exit codes in PowerShell.
 *
 * PowerShell-native cmdlets do NOT need exit-code semantics:
 *   - Select-String (grep equivalent) exits 0 on no-match (returns $null)
 *   - Compare-Object (diff equivalent) exits 0 regardless
 *   - Test-Path exits 0 regardless (returns bool via pipeline)
 * Native cmdlets signal failure via terminating errors ($?), not exit codes.
 *
 * However, EXTERNAL executables invoked from PowerShell DO set $LASTEXITCODE,
 * and many use non-zero codes to convey information rather than failure:
 *   - grep.exe / rg.exe (Git for Windows, scoop, etc.): 1 = no match
 *   - findstr.exe (Windows native): 1 = no match
 *   - robocopy.exe (Windows native): 0-7 = success, 8+ = error (notorious!)
 *
 * Without this module, PowerShellTool throws ShellError on any non-zero exit,
 * so `robocopy` reporting "files copied successfully" (exit 1) shows as an error.
 */

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}

/**
 * Default semantic: treat only 0 as success, everything else as error
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

/**
 * grep / ripgrep: 0 = matches found, 1 = no matches, 2+ = error
 */
const GREP_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'No matches found' : undefined,
})

/**
 * Linters / formatters (ruff, eslint): 0 = clean, 1 = violations/diffs found
 * (reported in the output, not a crash), 2+ = a real error (invalid config,
 * bad arguments). Treating exit 1 as an error makes the model retry a command
 * that already did its job.
 */
const LINT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'Lint violations found' : undefined,
})

/**
 * Wrapper runners that execute another tool (`uvx ruff check`, `npx eslint .`).
 * The wrapped tool determines $LASTEXITCODE, so we inherit its semantics when
 * it is one we recognize.
 */
const WRAPPER_COMMANDS = new Set(['uvx', 'npx'])

/**
 * Command-specific semantics for external executables.
 * Keys are lowercase command names WITHOUT .exe suffix.
 *
 * Deliberately omitted:
 *   - 'diff': Ambiguous. Windows PowerShell 5.1 aliases `diff` → Compare-Object
 *     (exit 0 on differ), but PS Core / Git for Windows may resolve to diff.exe
 *     (exit 1 on differ). Cannot reliably interpret.
 *   - 'fc': Ambiguous. PowerShell aliases `fc` → Format-Custom (a native cmdlet),
 *     but `fc.exe` is the Windows file compare utility (exit 1 = files differ).
 *     Same aliasing problem as `diff`.
 *   - 'find': Ambiguous. Windows find.exe (text search) vs Unix find.exe
 *     (file search via Git for Windows) have different semantics.
 *   - 'test', '[': Not PowerShell constructs.
 *   - 'select-string', 'compare-object', 'test-path': Native cmdlets exit 0.
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // External grep/ripgrep (Git for Windows, scoop, choco)
  ['grep', GREP_SEMANTIC],
  ['rg', GREP_SEMANTIC],

  // findstr.exe: Windows native text search
  // 0 = match found, 1 = no match, 2 = error
  ['findstr', GREP_SEMANTIC],

  // robocopy.exe: Windows native robust file copy
  // Exit codes are a BITFIELD — 0-7 are success, 8+ indicates at least one failure:
  //   0 = no files copied, no mismatch, no failures (already in sync)
  //   1 = files copied successfully
  //   2 = extra files/dirs detected (no copy)
  //   4 = mismatched files/dirs detected
  //   8 = some files/dirs could not be copied (copy errors)
  //  16 = serious error (robocopy did not copy any files)
  // This is the single most common "CI failed but nothing's wrong" Windows gotcha.
  [
    'robocopy',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 8,
      message:
        exitCode === 0
          ? 'No files copied (already in sync)'
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? 'Files copied successfully'
              : 'Robocopy completed (no errors)'
            : undefined,
    }),
  ],

  // ruff / eslint (external executables): 1 = lint violations found (reported,
  // not a crash), 2+ = real error. Also applied to `uvx ruff` / `npx eslint`
  // via the wrapper unwrap in interpretCommandResult.
  ['ruff', LINT_SEMANTIC],
  ['eslint', LINT_SEMANTIC],
])

/**
 * Extract the command name from a single pipeline segment.
 * Strips leading `&` / `.` call operators and Windows executable/shim suffixes
 * (`.exe`, `.cmd`, `.bat`, `.ps1`), lowercases.
 */
function extractBaseCommand(segment: string): string {
  // Strip PowerShell call operators: & "cmd", . "cmd"
  // (& and . at segment start followed by whitespace invoke the next token)
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const firstToken = stripped.split(/\s+/)[0] || ''
  // Strip surrounding quotes if command was invoked as & "grep.exe"
  const unquoted = firstToken.replace(/^["']|["']$/g, '')
  // Strip path: C:\bin\grep.exe → grep.exe, .\rg.exe → rg.exe
  const basename = unquoted.split(/[\\/]/).pop() || unquoted
  // Strip common Windows executable/shim suffixes so npm `.cmd` shims and other
  // PATHEXT variants resolve to the tool name (eslint.cmd -> eslint,
  // npx.cmd -> npx). Windows is case-insensitive.
  return basename.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
}

/**
 * Extract the primary command from a PowerShell command line.
 * Takes the LAST pipeline segment since that determines the exit code.
 *
 * Heuristic split on `;` and `|` — may get it wrong for quoted strings or
 * complex constructs. Do NOT depend on this for security; it's only used
 * for exit-code interpretation (false negatives just fall back to default).
 */
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = command.split(/[;|]/).filter(s => s.trim())
  const last = segments[segments.length - 1] || command
  return extractBaseCommand(last)
}

/**
 * Interpret command result based on semantic rules
 */
/**
 * For a wrapper invocation (`uvx <tool> ...`, `npx <tool> ...`) return the
 * normalized name of the wrapped tool — the first non-flag token after the
 * wrapper — so its exit-code semantics can be applied. Returns undefined when
 * no such token exists; an unrecognized wrapped name falls back to default.
 */
function extractWrappedCommand(
  command: string,
  wrapper: string,
): string | undefined {
  const segments = command.split(/[;|]/).filter(s => s.trim())
  const last = segments[segments.length - 1] || command
  const tokens = last
    .trim()
    .split(/\s+/)
    .filter(t => t && !/^[&.]$/.test(t))
  const wrapperIndex = tokens.findIndex(t => extractBaseCommand(t) === wrapper)
  if (wrapperIndex === -1) {
    return undefined
  }
  for (let i = wrapperIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token && !token.startsWith('-')) {
      return extractBaseCommand(token)
    }
  }
  return undefined
}

/**
 * Interpret command result based on semantic rules
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  let semantic = COMMAND_SEMANTICS.get(baseCommand)
  if (semantic === undefined && WRAPPER_COMMANDS.has(baseCommand)) {
    const wrapped = extractWrappedCommand(command, baseCommand)
    if (wrapped !== undefined) {
      semantic = COMMAND_SEMANTICS.get(wrapped)
    }
  }
  return (semantic ?? DEFAULT_SEMANTIC)(exitCode, stdout, stderr)
}
