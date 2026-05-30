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
 * Semantic factory for tools where exit code 1 is informational (issues found,
 * not a crash) and exit code 2+ means the tool itself failed. Covers most
 * linters, type checkers, and test runners.
 */
function exitOneInformational(message: string): CommandSemantic {
  return (exitCode, _stdout, _stderr) => {
    if (exitCode === 1) return { isError: false, message }
    if (exitCode >= 2)
      return { isError: true, message: `Command failed with exit code ${exitCode}` }
    return { isError: false }
  }
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

  // Linters: 0=clean, 1=violations found (informational), 2+=tool error
  ['ruff', exitOneInformational('Lint violations found')],
  ['eslint', exitOneInformational('Lint violations found')],
  ['flake8', exitOneInformational('Lint violations found')],
  ['biome', exitOneInformational('Lint violations found')],

  // Type checkers: 0=clean, 1=type errors found (informational), 2+=tool error
  ['mypy', exitOneInformational('Type errors found')],
  ['pyright', exitOneInformational('Type errors found')],

  // tsc is inverted vs other linters (verified against TypeScript 5.9):
  //   0=clean, 1=CLI/usage error (real failure), 2=diagnostics found,
  //   3+=config/internal error. Exit 2 (type/syntax errors) is informational —
  //   the model should read the diagnostics, not retry the command.
  [
    'tsc',
    (exitCode, _stdout, _stderr) => {
      if (exitCode === 0) return { isError: false }
      if (exitCode === 2)
        return { isError: false, message: 'Type errors found' }
      return { isError: true }
    },
  ],

  // Test runners: 0=all passed, 1=test failures (informational), 2+=runner error
  ['pytest', exitOneInformational('Test failures')],
  ['jest', exitOneInformational('Test failures')],
  ['vitest', exitOneInformational('Test failures')],
  // Compound key: only npm test / npm t / npm run test[:<variant>] get
  // informational semantics. npm install, npm publish, npm run build etc.
  // all have exit 1 = real failure and must keep DEFAULT_SEMANTIC.
  ['npm test', exitOneInformational('Test failures')],

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
  return semantic !== undefined ? semantic : DEFAULT_SEMANTIC
}

/**
 * Extract just the command name (first word) from a single command string,
 * with special handling for npm to scope test semantics to the test subcommand.
 */
function extractBaseCommand(command: string): string {
  const words = command.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const first = words[0]!
  // npm: only `npm test` / `npm t` / `npm run test[:<variant>]` get
  // informational semantics — other subcommands (install, publish, build…)
  // exit 1 on real failures and must fall through to DEFAULT_SEMANTIC.
  if (first === 'npm') {
    const sub = words[1]
    if (sub === 'test' || sub === 't') return 'npm test'
    if (sub === 'run' && words[2] && /^test(:.+)?$/.test(words[2])) return 'npm test'
    return first
  }
  return first
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
