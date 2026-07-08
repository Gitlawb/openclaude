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
 * Linters, formatters, and test runners commonly use exit 1 to mean "I ran and
 * found diagnostics/failing tests", not "the command crashed".
 */
const DIAGNOSTIC_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message:
    exitCode === 1
      ? 'violations or test failures reported'
      : exitCode >= 2
        ? `Command failed with exit code ${exitCode}`
        : undefined,
})

/**
 * `tsc` can report type diagnostics with either exit 1 or 2 depending on mode
 * (for example, build mode uses DiagnosticsPresent_OutputsSkipped = 1).
 */
const TSC_SEMANTIC: CommandSemantic = (exitCode, stdout, stderr) => {
  const output = stdout + stderr
  const hasTypeScriptUsageError =
    /error TS(?:5023|5024|5025|5029|5057|6053|6054):|Unknown compiler option|Compiler option .* requires a value|File .* not found/i.test(
      output,
    )
  const hasTypeScriptDiagnostics =
    !hasTypeScriptUsageError &&
    (exitCode === 2 || (exitCode === 1 && /error TS\d+/i.test(output)))
  return {
    isError: exitCode !== 0 && !hasTypeScriptDiagnostics,
    message: hasTypeScriptDiagnostics
      ? 'type errors reported'
      : exitCode !== 0
        ? `Command failed with exit code ${exitCode}`
        : undefined,
  }
}

/**
 * `pylint` uses a bitfield: bits 0-4 are diagnostics, bit 5 is usage error.
 */
const PYLINT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: (exitCode & 32) !== 0,
  message:
    (exitCode & 32) !== 0
      ? `Command failed with exit code ${exitCode}`
      : exitCode !== 0
        ? 'lint diagnostics reported'
        : undefined,
})

/**
 * Wrapper runners that execute another tool. The wrapped tool determines the
 * exit code, so inherit its semantics when the wrapped command is recognized.
 */
const WRAPPER_COMMANDS = new Set([
  'uvx',
  'npx',
  'npm',
  'bunx',
  'pipx',
  'python',
  'python3',
  'py',
  'pnpm',
  'yarn',
  'bun',
])

const WRAPPER_VALUE_FLAGS = new Set([
  '-p',
  '--package',
  '--from',
  '--with',
  '--spec',
  '--python',
  '--env-file',
  '--cache-dir',
])

const ENV_VALUE_FLAGS = new Set([
  '-u',
  '--unset',
  '-c',
  '-C',
  '-s',
  '-S',
  '-p',
  '-P',
])
const ENV_SPLIT_STRING_FLAGS = new Set(['-s', '-S', '--split-string'])

const PACKAGE_SCRIPT_COMMANDS = new Map([
  ['lint', 'eslint'],
  ['lint:fix', 'eslint'],
  ['test', 'jest'],
  ['test:unit', 'jest'],
  ['test:watch', 'jest'],
  ['typecheck', 'tsc'],
  ['type-check', 'tsc'],
])

const PACKAGE_SCRIPT_RUN_COMMANDS = new Set(['run', 'run-script'])
const PACKAGE_SCRIPT_VALUE_FLAGS = new Set([
  '--workspace',
  '-w',
  '--filter',
  '-F',
  '-f',
  '--cwd',
  '--dir',
  '-C',
  '-c',
])

function skipPackageManagerPrefixes(
  normalized: string[],
  startIndex: number,
): number {
  let i = startIndex
  while (i < normalized.length) {
    const token = normalized[i]
    if (!token) {
      i += 1
      continue
    }
    if (token === '--') {
      i += 1
      continue
    }
    if (token === 'workspace') {
      i += 2
      continue
    }
    if (token.startsWith('-')) {
      const flagName = token.split('=')[0] ?? token
      i += PACKAGE_SCRIPT_VALUE_FLAGS.has(flagName) && !token.includes('=')
        ? 2
        : 1
      continue
    }
    break
  }
  return i
}

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

  // Common linters, formatters, and test runners from #1436.
  ['ruff', DIAGNOSTIC_SEMANTIC],
  ['eslint', DIAGNOSTIC_SEMANTIC],
  ['flake8', DIAGNOSTIC_SEMANTIC],
  ['biome', DIAGNOSTIC_SEMANTIC],
  ['mypy', DIAGNOSTIC_SEMANTIC],
  ['pyright', DIAGNOSTIC_SEMANTIC],
  ['prettier', DIAGNOSTIC_SEMANTIC],
  ['black', DIAGNOSTIC_SEMANTIC],
  ['pytest', DIAGNOSTIC_SEMANTIC],
  ['jest', DIAGNOSTIC_SEMANTIC],
  ['vitest', DIAGNOSTIC_SEMANTIC],
  ['tsc', TSC_SEMANTIC],
  ['pylint', PYLINT_SEMANTIC],
])

const DIAGNOSTIC_COMMANDS = new Set([
  'ruff',
  'eslint',
  'flake8',
  'biome',
  'mypy',
  'pyright',
  'prettier',
  'black',
  'pytest',
  'jest',
  'vitest',
  'tsc',
  'pylint',
])

function resolvePackageScriptCommand(
  normalized: string[],
  startIndex: number,
  allowDirectAlias: boolean,
): string | undefined {
  let i = skipPackageManagerPrefixes(normalized, startIndex)
  const first = normalized[i]
  if (first === undefined) {
    return undefined
  }
  if (first === 'test') {
    return PACKAGE_SCRIPT_COMMANDS.get('test')
  }
  if (PACKAGE_SCRIPT_RUN_COMMANDS.has(first)) {
    i += 1
  } else if (!allowDirectAlias) {
    return undefined
  }

  for (; i < normalized.length; i++) {
    const token = normalized[i]
    if (!token) {
      continue
    }
    if (token === '--') {
      continue
    }
    if (token.startsWith('-')) {
      const flagName = token.split('=')[0] ?? token
      i += PACKAGE_SCRIPT_VALUE_FLAGS.has(flagName) && !token.includes('=') ? 1 : 0
      continue
    }
    return (
      PACKAGE_SCRIPT_COMMANDS.get(token) ??
      (COMMAND_SEMANTICS.has(token) ? token : undefined)
    )
  }
  return undefined
}

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

function splitStatements(command: string): string[] {
  const statements: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    const next = command[i + 1]
    if ((char === '"' || char === "'") && quote === undefined) {
      quote = char
    } else if (char === quote) {
      quote = undefined
    }
    if (quote === undefined) {
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
        if (current.trim()) {
          statements.push(current)
        }
        current = ''
        i += 1
        continue
      }
      if (char === '&' && current.trim()) {
        statements.push(current)
        current = ''
        continue
      }
      if (char === ';' || char === '|' || char === '\n') {
        if (current.trim()) {
          statements.push(current)
        }
        current = ''
        continue
      }
      if (char === '\r') {
        continue
      }
    }
    current += char
  }
  if (current.trim()) {
    statements.push(current)
  }
  return statements
}

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function skipEnvUtility(tokens: string[], startIndex: number): number {
  let i = startIndex + 1
  while (i < tokens.length) {
    const rawToken = tokens[i]
    if (rawToken === undefined) {
      break
    }
    const token = extractBaseCommand(rawToken)
    if (token === '--') {
      return i + 1
    }
    if (isEnvAssignment(rawToken)) {
      i += 1
      continue
    }
    if (token.startsWith('-')) {
      const flagName = token.split('=')[0] ?? token
      i += ENV_VALUE_FLAGS.has(flagName) && !token.includes('=') ? 2 : 1
      continue
    }
    break
  }
  return i
}

function collectQuotedTokenPayload(
  first: string,
  tokens: string[],
  nextIndex: number,
): string {
  const quote = first[0]
  if (quote !== '"' && quote !== "'") {
    return first
  }
  const collected = [first]
  if (first.length > 1 && first.endsWith(quote)) {
    return collected.join(' ').replace(/^["']|["']$/g, '')
  }
  for (let i = nextIndex; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) {
      break
    }
    collected.push(token)
    if (token.endsWith(quote)) {
      break
    }
  }
  return collected.join(' ').replace(/^["']|["']$/g, '')
}

function getEnvSplitStringPayload(
  tokens: string[],
  flagIndex: number,
): string | undefined {
  const flag = tokens[flagIndex]
  if (flag === undefined) {
    return undefined
  }
  const inlineValue =
    flag.match(/^--split-string=(.*)$/)?.[1] ?? flag.match(/^-[sS]=(.*)$/)?.[1]
  if (inlineValue !== undefined) {
    return collectQuotedTokenPayload(inlineValue, tokens, flagIndex + 1)
  }
  const first = tokens[flagIndex + 1]
  if (first === undefined) {
    return undefined
  }
  return collectQuotedTokenPayload(first, tokens, flagIndex + 2)
}

function extractEnvSplitStringBaseCommand(
  tokens: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex + 1; i < tokens.length; i++) {
    const rawToken = tokens[i]
    if (rawToken === undefined) {
      break
    }
    const token = extractBaseCommand(rawToken)
    const flagName = rawToken.startsWith('--split-string=')
      ? '--split-string'
      : token.split('=')[0] ?? token
    if (ENV_SPLIT_STRING_FLAGS.has(flagName)) {
      const payload = getEnvSplitStringPayload(tokens, i)
      return payload !== undefined
        ? extractSemanticBaseCommand(payload)
        : undefined
    }
    if (token === '--') {
      break
    }
  }
  return undefined
}

function extractRunnableBaseCommand(tokens: string[]): string {
  let i = 0
  while (i < tokens.length) {
    const rawToken = tokens[i]
    if (rawToken === undefined) {
      break
    }
    if (isEnvAssignment(rawToken)) {
      i += 1
      continue
    }
    const token = extractBaseCommand(rawToken)
    if (token === '&' || token === '.') {
      i += 1
      continue
    }
    if (token === 'env') {
      const splitStringBase = extractEnvSplitStringBaseCommand(tokens, i)
      if (splitStringBase !== undefined) {
        return splitStringBase
      }
      i = skipEnvUtility(tokens, i)
      continue
    }
    return token
  }
  return tokens[0] !== undefined ? extractBaseCommand(tokens[0]) : ''
}

function extractSemanticBaseCommand(command: string): string {
  const baseCommand = extractRunnableBaseCommand(command.trim().split(/\s+/))
  if (WRAPPER_COMMANDS.has(baseCommand)) {
    return extractWrappedCommand(command, baseCommand) ?? baseCommand
  }
  return baseCommand
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
  const segments = splitStatements(command)
  const last = segments[segments.length - 1] || command
  return extractRunnableBaseCommand(last.trim().split(/\s+/))
}

/**
 * For a runner invocation return the wrapped tool name so its exit-code
 * semantics can be applied. Returns undefined for non-runner forms such as
 * `python script.py`, so they fall back to the default semantic.
 */
function extractWrappedCommand(
  command: string,
  wrapper: string,
): string | undefined {
  const segments = splitStatements(command)
  const last = segments[segments.length - 1] || command
  const tokens = last
    .trim()
    .split(/\s+/)
    .filter(t => t && !/^[&.]$/.test(t))
  const normalized = tokens.map(extractBaseCommand)
  const wrapperIndex = tokens.findIndex(t => extractBaseCommand(t) === wrapper)
  if (wrapperIndex === -1) {
    return undefined
  }

  let i = wrapperIndex + 1
  if (wrapper === 'python' || wrapper === 'python3' || wrapper === 'py') {
    if (normalized[i] !== '-m') {
      return undefined
    }
    i += 1
  } else if (wrapper === 'npm') {
    i = skipPackageManagerPrefixes(normalized, i)
    const scriptCommand = resolvePackageScriptCommand(normalized, i, false)
    if (scriptCommand !== undefined) {
      return scriptCommand
    }
    if (PACKAGE_SCRIPT_RUN_COMMANDS.has(normalized[i] ?? '')) {
      return undefined
    }
    if (normalized[i] === 'exec' || normalized[i] === 'x') {
      i += 1
    } else {
      return undefined
    }
  } else if (wrapper === 'pnpm' || wrapper === 'yarn') {
    i = skipPackageManagerPrefixes(normalized, i)
    if (normalized[i] !== 'exec') {
      const scriptCommand = resolvePackageScriptCommand(normalized, i, true)
      if (scriptCommand !== undefined) {
        return scriptCommand
      }
      if (PACKAGE_SCRIPT_RUN_COMMANDS.has(normalized[i] ?? '')) {
        return undefined
      }
    } else {
      i += 1
    }
  } else if (wrapper === 'bun') {
    if (normalized[i] !== 'exec' && normalized[i] !== 'x') {
      return undefined
    }
    i += 1
  } else if (wrapper === 'pipx') {
    if (normalized[i] !== 'run') {
      return undefined
    }
    i += 1
  }

  for (; i < tokens.length; i++) {
    const rawToken = tokens[i]
    const token = normalized[i]
    if (!rawToken || !token) {
      continue
    }
    if (token.startsWith('-')) {
      const flagName = token.split('=')[0] ?? token
      const takesValue =
        WRAPPER_VALUE_FLAGS.has(flagName) ||
        ((wrapper === 'npm' || wrapper === 'pnpm' || wrapper === 'yarn') &&
          PACKAGE_SCRIPT_VALUE_FLAGS.has(flagName))
      i += takesValue && !token.includes('=') ? 1 : 0
      continue
    }
    return token
  }
  return undefined
}

function usesKnownWrapper(command: string): boolean {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  if (!WRAPPER_COMMANDS.has(baseCommand)) {
    return false
  }
  const wrapped = extractWrappedCommand(command, baseCommand)
  return wrapped !== undefined && COMMAND_SEMANTICS.has(wrapped)
}

function getWrapperFailureCommand(command: string): string {
  const segments = splitStatements(command)
  const lastCommand = segments[segments.length - 1] || command
  const tokens = lastCommand
    .trim()
    .split(/\s+/)
    .filter(t => t && !/^[&.]$/.test(t))
  const envIndex = tokens.findIndex(token => extractBaseCommand(token) === 'env')
  if (envIndex === -1) {
    return command
  }
  const payload = getEnvSplitStringPayloadForEnv(tokens, envIndex)
  return payload ?? command
}

function getEnvSplitStringPayloadForEnv(
  tokens: string[],
  startIndex: number,
): string | undefined {
  for (let i = startIndex + 1; i < tokens.length; i++) {
    const rawToken = tokens[i]
    if (rawToken === undefined) {
      break
    }
    const token = extractBaseCommand(rawToken)
    const flagName = rawToken.startsWith('--split-string=')
      ? '--split-string'
      : token.split('=')[0] ?? token
    if (ENV_SPLIT_STRING_FLAGS.has(flagName)) {
      return getEnvSplitStringPayload(tokens, i)
    }
    if (token === '--') {
      break
    }
  }
  return undefined
}

function looksLikeWrapperFailure(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  result: { isError: boolean },
): boolean {
  const wrapperCommand = getWrapperFailureCommand(command)
  if (exitCode === 0 || result.isError || !usesKnownWrapper(wrapperCommand)) {
    return false
  }
  const failureOutput = combineFailureOutput(stdout, stderr)
  if (failureOutput.length === 0) {
    return false
  }
  return /(^|\n)\s*(npm (ERR!|error) code (?!ELIFECYCLE\b)\S+|pnpm ERR! (?!Command failed with exit code\b)|yarn (error|ERR!)|bunx? (error|ERR!)|pipx(:| ).*error|Fatal error from pip|error: failed to (download|install|fetch)|failed to download|failed to install|No matching distribution found|Could not find a version that satisfies)/i.test(
    failureOutput,
  )
}

function combineFailureOutput(stdout: string, stderr: string): string {
  return [stderr, stdout]
    .map(output => output.trim())
    .filter(Boolean)
    .join('\n')
}

const POWERSHELL_ALIAS_COMMANDS = new Map([
  ['cd', 'set-location'],
  ['chdir', 'set-location'],
  ['sl', 'set-location'],
  ['cat', 'get-content'],
  ['gc', 'get-content'],
  ['type', 'get-content'],
  ['ls', 'get-childitem'],
  ['dir', 'get-childitem'],
  ['gci', 'get-childitem'],
  ['echo', 'write-output'],
  ['write', 'write-output'],
  ['rm', 'remove-item'],
  ['del', 'remove-item'],
  ['erase', 'remove-item'],
  ['rmdir', 'remove-item'],
  ['rd', 'remove-item'],
])

const SILENT_FAILURE_COMMANDS = new Set([
  '$false',
  'false',
  'test-path',
  'set-location',
])

function getNonFinalCommandNames(command: string): string[] {
  const segments = splitStatements(command)
  if (segments.length < 2) {
    return []
  }
  return segments
    .slice(0, -1)
    .map(segment => {
      const commandName = extractRunnableBaseCommand(segment.trim().split(/\s+/))
      return POWERSHELL_ALIAS_COMMANDS.get(commandName) ?? commandName
    })
    .filter(Boolean)
}

function hasUnquotedShortCircuitOrPipeline(command: string): boolean {
  let quote: '"' | "'" | undefined
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    const next = command[i + 1]
    const prev = command[i - 1]
    if ((char === '"' || char === "'") && quote === undefined) {
      quote = char
      continue
    }
    if (char === quote) {
      quote = undefined
      continue
    }
    if (quote !== undefined) {
      continue
    }
    if (char === '&' && next === '&') {
      return true
    }
    if (char === '|' && next !== '|' && prev !== '|') {
      return true
    }
  }
  return false
}

function getResolvedDiagnosticCommandName(command: string): string | undefined {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  if (DIAGNOSTIC_COMMANDS.has(baseCommand)) {
    return baseCommand
  }
  if (!WRAPPER_COMMANDS.has(baseCommand)) {
    return undefined
  }
  const wrapped = extractWrappedCommand(command, baseCommand)
  return wrapped !== undefined && DIAGNOSTIC_COMMANDS.has(wrapped)
    ? wrapped
    : undefined
}

function looksLikeSilentSkippedDiagnostic(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  result: { isError: boolean },
): boolean {
  const previousCommands = getNonFinalCommandNames(command)
  return (
    exitCode !== 0 &&
    !result.isError &&
    combineFailureOutput(stdout, stderr).length === 0 &&
    hasUnquotedShortCircuitOrPipeline(command) &&
    getResolvedDiagnosticCommandName(command) !== undefined &&
    previousCommands.some(commandName => SILENT_FAILURE_COMMANDS.has(commandName))
  )
}

function looksLikeSetupOrPipelineFailure(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  result: { isError: boolean },
): boolean {
  if (exitCode === 0 || result.isError) {
    return false
  }
  const previousCommands = getNonFinalCommandNames(command)
  if (previousCommands.length === 0) {
    return false
  }
  const failureOutput = combineFailureOutput(stdout, stderr)
  return previousCommands.some(commandName => {
    const escaped = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(
      `(^|\\n)\\s*${escaped}\\s*:.*(cannot find path|does not exist|no such file|not found|command not found|permission denied|not recognized)`,
      'i',
    ).test(failureOutput)
  })
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
  const result = (semantic ?? DEFAULT_SEMANTIC)(exitCode, stdout, stderr)
  if (looksLikeWrapperFailure(command, exitCode, stdout, stderr, result)) {
    return DEFAULT_SEMANTIC(exitCode, stdout, stderr)
  }
  if (
    looksLikeSetupOrPipelineFailure(command, exitCode, stdout, stderr, result)
  ) {
    return DEFAULT_SEMANTIC(exitCode, stdout, stderr)
  }
  if (
    looksLikeSilentSkippedDiagnostic(command, exitCode, stdout, stderr, result)
  ) {
    return DEFAULT_SEMANTIC(exitCode, stdout, stderr)
  }
  return result
}
