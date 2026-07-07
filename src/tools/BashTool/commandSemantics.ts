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
 * `tsc` exits 2 for reported type errors, while exit 1 means bad usage/config.
 */
const TSC_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0 && exitCode !== 2,
  message:
    exitCode === 2
      ? 'type errors reported'
      : exitCode !== 0
        ? `Command failed with exit code ${exitCode}`
        : undefined,
})

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
  } else if (wrapper === 'pnpm' || wrapper === 'yarn') {
    if (normalized[i] !== 'exec') {
      return undefined
    }
    i += 1
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
      i += WRAPPER_VALUE_FLAGS.has(flagName) && !token.includes('=') ? 1 : 0
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
      i = skipEnvUtility(tokens, i)
      continue
    }
    return token
  }
  return tokens[0] !== undefined ? extractBaseCommand(tokens[0]) : ''
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

function looksLikeWrapperFailure(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  result: { isError: boolean },
): boolean {
  if (exitCode === 0 || result.isError || !usesKnownWrapper(command)) {
    return false
  }
  if (stderr.trim().length === 0) {
    return false
  }
  return /(^|\n)\s*(npm ERR!|pnpm ERR!|yarn (error|ERR!)|bunx? (error|ERR!)|pipx(:| ).*error|Fatal error from pip|error: failed to (download|install|fetch|resolve)|failed to download|failed to install|No matching distribution found|Could not find a version that satisfies)/i.test(
    stderr,
  )
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
  if (stdout.trim().length > 0) {
    return false
  }
  const previousCommands = getNonFinalCommandNames(command)
  if (previousCommands.length === 0) {
    return false
  }
  return previousCommands.some(commandName => {
    const escaped = commandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(
      `(^|\\n)\\s*${escaped}:.*(no such file|not found|permission denied|does not exist)`,
      'i',
    ).test(stderr)
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

  return {
    isError: result.isError,
    message: result.message,
  }
}
