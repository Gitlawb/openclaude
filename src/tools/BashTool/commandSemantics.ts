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
 * Linters / formatters: 0 = clean, 1 = violations/diffs found (reported in the
 * output, not a crash), 2+ = a real error (invalid config, bad arguments).
 * Treating exit 1 as an error makes the model retry a command that already did
 * its job, so surface it as a non-error result instead.
 */
const LINT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'Lint violations found' : undefined,
})

/**
 * Wrapper runners that execute another tool (e.g. `uvx ruff check`,
 * `npx eslint .`). The wrapped tool determines the exit code, so we inherit
 * its semantics when it is one we recognize.
 */
const WRAPPER_COMMANDS = new Set(['uvx', 'npx'])

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

  // ruff / eslint: 0=clean, 1=lint violations found (reported, not a crash),
  // 2+=real error (invalid config/args). Also applied to `uvx ruff` / `npx
  // eslint` via the wrapper unwrap in getCommandSemantic.
  ['ruff', LINT_SEMANTIC],
  ['eslint', LINT_SEMANTIC],

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
  // uvx/npx run another tool; inherit that tool's semantics when we can
  // confidently identify a known one (e.g. `uvx ruff check`, `npx -y eslint .`).
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
 * For a wrapper invocation (`uvx <tool> ...`, `npx <tool> ...`) return the name
 * of the wrapped tool — the first non-flag token after the wrapper — so its
 * exit-code semantics can be applied. Returns undefined when no such token
 * exists; an unrecognized wrapped name (e.g. a `--from` package) simply falls
 * back to the default semantic.
 */
function extractWrappedCommand(
  command: string,
  wrapper: string,
): string | undefined {
  const segments = splitCommand_DEPRECATED(command)
  const lastCommand = segments[segments.length - 1] || command
  const tokens = lastCommand.trim().split(/\s+/)
  // Match the wrapper by its normalized name so a resolved or quoted path
  // (`/usr/bin/uvx`, `"npx"`) still counts as the wrapper.
  const wrapperIndex = tokens.findIndex(
    token => extractBaseCommand(token) === wrapper,
  )
  if (wrapperIndex === -1) {
    return undefined
  }
  for (let i = wrapperIndex + 1; i < tokens.length; i++) {
    const token = tokens[i]
    if (token && !token.startsWith('-')) {
      // Normalize the wrapped tool too: `npx ./node_modules/.bin/eslint` must
      // resolve to `eslint` so its lint semantics apply.
      return extractBaseCommand(token)
    }
  }
  return undefined
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

  return extractBaseCommand(lastCommand)
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

  return {
    isError: result.isError,
    message: result.message,
  }
}
