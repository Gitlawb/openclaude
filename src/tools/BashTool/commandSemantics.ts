/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 */

import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'

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

const ENV_VALUE_FLAGS = new Set(['-u', '--unset', '-C', '-S', '-P'])
const ENV_SPLIT_STRING_FLAGS = new Set(['-S', '--split-string'])

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
  '--cwd',
  '--dir',
  '-C',
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
 * Command-specific semantics
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // grep: 0=matches found, 1=no matches, 2+=error
  [
    'grep',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // ripgrep has same semantics as grep
  [
    'rg',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
  [
    'find',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message:
        exitCode === 1 ? 'Some directories were inaccessible' : undefined,
    }),
  ],

  // diff: 0=no differences, 1=differences found, 2+=error
  [
    'diff',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Files differ' : undefined,
    }),
  ],

  // test/[: 0=condition true, 1=condition false, 2+=error
  [
    'test',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],

  // [ is an alias for test
  [
    '[',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
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

  // wc, head, tail, cat, etc.: these typically only fail on real errors
  // so we use default semantics
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
 * Get the semantic interpretation for a command
 */
function getCommandSemantic(command: string): CommandSemantic {
  // Extract the base command (first word, handling pipes)
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand)
  if (semantic !== undefined) {
    return semantic
  }
  // Runner commands inherit the wrapped tool's semantics when we can identify a
  // known command (e.g. `python -m pytest`, `pipx run ruff`, `bunx vitest`).
  if (WRAPPER_COMMANDS.has(baseCommand)) {
    const wrapped = extractWrappedCommand(command, baseCommand)
    const wrappedSemantic =
      wrapped !== undefined ? COMMAND_SEMANTICS.get(wrapped) : undefined
    if (wrappedSemantic !== undefined) {
      return wrappedSemantic
    }
  }
  return DEFAULT_SEMANTIC
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
  const segments = splitCommand_DEPRECATED(command)
  const lastCommand = segments[segments.length - 1] || command
  const tokens = lastCommand.trim().split(/\s+/)
  const normalized = tokens.map(extractBaseCommand)
  // Match the wrapper by its normalized name so a resolved or quoted path
  // (`/usr/bin/uvx`, `"npx"`) still counts as the wrapper.
  const wrapperIndex = normalized.findIndex(token => token === wrapper)
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
    flag.match(/^--split-string=(.*)$/)?.[1] ?? flag.match(/^-S=(.*)$/)?.[1]
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
 * Extract just the command name from a single command string, normalized so a
 * path-prefixed or quoted invocation still maps to a known command. Mirrors the
 * PowerShell implementation (minus the Windows-only `.exe`/case handling):
 * `./node_modules/.bin/eslint` → `eslint`, `"ruff"` → `ruff`,
 * `/usr/bin/uvx` → `uvx`. Otherwise these fall through to the default
 * exit-code semantics and a linter's exit 1 is mis-reported as an error.
 */
function extractBaseCommand(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0] || ''
  // Strip surrounding quotes: "ruff" / 'eslint' → ruff / eslint.
  const unquoted = firstToken.replace(/^["']|["']$/g, '')
  // Strip any path prefix (POSIX separator): ./node_modules/.bin/eslint →
  // eslint, /usr/bin/uvx → uvx.
  return unquoted.split('/').pop() || unquoted
}

/**
 * Extract the primary command from a complex command line;
 * May get it super wrong - don't depend on this for security
 */
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = splitCommand_DEPRECATED(command)

  // Take the last command as that's what determines the exit code
  const lastCommand = segments[segments.length - 1] || command

  return extractRunnableBaseCommand(lastCommand.trim().split(/\s+/))
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
  const segments = splitCommand_DEPRECATED(command)
  const lastCommand = segments[segments.length - 1] || command
  const tokens = lastCommand.trim().split(/\s+/)
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

function getNonFinalCommandNames(command: string): string[] {
  const segments = splitCommand_DEPRECATED(command)
  if (segments.length < 2) {
    return []
  }
  return segments
    .slice(0, -1)
    .map(segment => extractRunnableBaseCommand(segment.trim().split(/\s+/)))
    .filter(Boolean)
}

const SILENT_FAILURE_COMMANDS = new Set(['false', 'test', '[', 'cd', 'pushd'])

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
    const failureText =
      '(no such file|not found|command not found|permission denied|does not exist)'
    const commandPrefixedFailure = new RegExp(
      `(^|\\n)\\s*(?:[\\w.-]+:\\s*(?:line\\s+\\d+:\\s*)?)?${escaped}:.*${failureText}`,
      'i',
    )
    const envFailure = new RegExp(
      `(^|\\n)\\s*env:.*${escaped}.*${failureText}`,
      'i',
    )
    return (
      commandPrefixedFailure.test(failureOutput) ||
      envFailure.test(failureOutput)
    )
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
  const semantic = getCommandSemantic(command)
  const result = semantic(exitCode, stdout, stderr)
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

  return {
    isError: result.isError,
    message: result.message,
  }
}
