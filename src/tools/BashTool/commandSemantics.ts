/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 * Most linters and test runners follow the same pattern: exit code 1 means "issues
 * found" (something the model should read and act on, not retry), while exit code 2+
 * means the tool itself failed. Exceptions exist — e.g. tsc inverts this — so the
 * per-command semantics below are authoritative over the general rule.
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
      return { isError: true }
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
  // Compound keys: only the test subcommand gets informational semantics.
  // install/publish/build/run <non-test> all have exit 1 = real failure.
  ['npm test', exitOneInformational('Test failures')],
  ['yarn test', exitOneInformational('Test failures')],
  ['pnpm test', exitOneInformational('Test failures')],
  // bun test is bun's built-in runner (exit 1 = failures).
  // bun run <script> delegates to an arbitrary runner — handled separately.
  ['bun test', exitOneInformational('Test failures')],

  // pylint uses an OR-ed bitfield exit code:
  //   1=fatal, 2=error msg, 4=warning, 8=refactor, 16=convention, 32=usage error
  // Only a fatal pylint crash (1) or a CLI usage error (32) is a real failure;
  // the message bits (2/4/8/16) are lint findings the model should read.
  [
    'pylint',
    (exitCode, _stdout, _stderr) => {
      if (exitCode === 0) return { isError: false }
      const fatal = (exitCode & 1) !== 0
      const usageError = (exitCode & 32) !== 0
      return {
        isError: fatal || usageError,
        message: fatal || usageError ? undefined : 'Lint messages found',
      }
    },
  ],

  // wc, head, tail, cat, etc.: these typically only fail on real errors
  // so we use default semantics
])

/**
 * Package/module runners that invoke another tool as a subprocess and inherit
 * its exit code. To interpret the exit code correctly we must look past the
 * runner to the tool it actually runs (e.g. `uvx ruff check` → ruff).
 */
const PACKAGE_RUNNERS = new Set(['uvx', 'npx', 'bunx', 'pipx'])
const MODULE_RUNNERS = new Set(['python', 'python3'])
const RUN_SUBCOMMANDS = new Set(['run'])
// Runner flags that take a separate value (the next token is the flag's
// argument, not the tool to run). e.g. `npx -p typescript tsc` runs tsc.
const VALUE_FLAGS = new Set(['-p', '--package', '-c', '--call', '-w', '--workspace'])

/**
 * Resolve a raw token to a bare command name: strip any leading path and a
 * trailing version pin or Windows extension, and normalize quotes.
 *   ./node_modules/.bin/eslint → eslint
 *   /usr/bin/ruff              → ruff
 *   eslint@8.0.0               → eslint
 *   ruff.exe                   → ruff
 *   "./path/to/cmd"            → cmd
 */
function resolveToolName(token: string): string {
  // Remove surrounding quotes (both single and double)
  let clean = token.replace(/^['"]|['"]$/g, '')
  // Split by path separators and take the last component
  const base = clean.split(/[/\\]/).pop() || clean
  // Remove version pins (@8.0.0) and Windows extensions (.exe, .cmd, etc.)
  return base.replace(/@.*$/, '').replace(/\.(exe|cmd|bat|ps1)$/i, '')
}

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
 * Extract the effective command name from a single command string, looking past
 * package/module runners and resolving path/version-pinned invocations.
 *   uvx ruff check --fix    → ruff
 *   npx --yes eslint .      → eslint
 *   python -m ruff check    → ruff
 *   pipx run black          → black
 *   ./node_modules/.bin/tsc → tsc
 */
function extractBaseCommand(command: string): string {
  const words = command.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''

  // Skip leading environment variable assignments (TOKEN=value)
  let firstCmdIdx = 0
  for (let i = 0; i < words.length; i++) {
    if (!words[i].includes('=')) {
      firstCmdIdx = i
      break
    }
  }

  const first = resolveToolName(words[firstCmdIdx])

  // `python -m <module>` / `python3 -m <module>`: the module is the real tool.
  // `-m` must immediately follow the interpreter — a later `-m` is a script arg.
  // A bare `python script.py` keeps default semantics (exit 1 = real error).
  if (MODULE_RUNNERS.has(first)) {
    if (words[firstCmdIdx + 1] === '-m' && words[firstCmdIdx + 2]) {
      return resolveToolName(words[firstCmdIdx + 2])
    }
    return first
  }

  // Package managers: scope informational semantics to the test subcommand.
  // Other subcommands (install/publish/build/run <non-test>) exit 1 on real
  // failures and must fall through to DEFAULT_SEMANTIC.
  if (first === 'npm' || first === 'yarn' || first === 'pnpm') {
    const sub = words[firstCmdIdx + 1]
    const key = `${first} test` as const
    if (sub === 'test' || sub === 't') return key
    if (sub === 'run' && words[firstCmdIdx + 2] && /^test(:.+)?$/.test(words[firstCmdIdx + 2])) return key
    return first
  }

  // bun test = bun's built-in runner (exit 1 = failures).
  // bun run <script> proxies to an arbitrary runner — keep default semantics.
  if (first === 'bun') {
    if (words[firstCmdIdx + 1] === 'test') return 'bun test'
    return first
  }

  // Package runners: skip the runner, value-flags and their argument, plain
  // flags, and a `run` subcommand, then take the first real argument as the
  // tool being executed.
  if (PACKAGE_RUNNERS.has(first)) {
    for (let i = firstCmdIdx + 1; i < words.length; i++) {
      const w = words[i]
      if (VALUE_FLAGS.has(w)) {
        i++ // also skip the flag's value
        continue
      }
      if (w.startsWith('-')) continue
      if (RUN_SUBCOMMANDS.has(w)) continue
      return resolveToolName(w)
    }
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
