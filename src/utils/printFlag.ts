/**
 * Detects the boolean `-p, --print` flag in raw argv, including the forms
 * commander accepts for a boolean option: `-p`, `--print`, `--print=prompt`,
 * and attached short-option values like `-pprompt`.
 *
 * The scan is option-arity-aware: tokens consumed as values by preceding
 * value-taking options (e.g. `--system-prompt --print=custom`) are skipped,
 * matching commander’s behavior. Required-value options consume the next token
 * unconditionally; optional-value options consume the next token only when it
 * does not start with `-`. Variadic options consume consecutive non-flag values.
 *
 * Stops at `--` so positional values after the end-of-options marker are not
 * mistaken for flags.
 */

// Options registered on the main command that take a required value. The next
// token is always their value, even if it looks like a flag.
const REQUIRED_VALUE_OPTIONS = new Set([
  '--debug-file',
  '--heartbeat',
  '--output-format',
  '--json-schema',
  '--max-thinking-tokens',
  '--max-turns',
  '--max-budget-usd',
  '--task-budget',
  '--thinking',
  '--system-prompt',
  '--system-prompt-file',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--permission-mode',
  '--model',
  '--provider',
  '--effort',
  '--agent',
  '--fallback-model',
  '--workload',
  '--settings',
  '--name',
  '-n',
  '--agents',
  '--setting-sources',
  '--session-id',
  '--plugin-dir',
  '--provider-env-file',
  '--deep-link-repo',
  '--deep-link-last-fetch',
  '--resume-session-at',
  '--rewind-files',
  '--prefill',
  '--permission-prompt-tool',
  '--input-format',
])

// Variadic options consume one or more following non-flag values.
const VARIADIC_OPTIONS = new Set([
  '--add-dir',
  '--mcp-config',
  '--file',
  '--tools',
  '--allowed-tools',
  '--allowedTools',
  '--disallowed-tools',
  '--disallowedTools',
  '--betas',
  '--plugin-dir',
  '--provider-env-file',
])

// Options that take an optional value. They consume the next token only when
// it does not start with `-`, so a following flag remains available.
const OPTIONAL_VALUE_OPTIONS = new Set(['--debug', '-d', '--resume', '-r', '--from-pr'])

function optionName(arg: string): string {
  // `--system-prompt=--print=custom` -> `--system-prompt`; the value is in the
  // same token, so no following token needs to be skipped.
  const eq = arg.indexOf('=')
  return eq === -1 ? arg : arg.slice(0, eq)
}

function isPrintFlag(arg: string): boolean {
  return (
    arg === '-p' ||
    arg === '--print' ||
    arg.startsWith('--print=') ||
    (arg.startsWith('-p') && arg.length > 2)
  )
}

export function hasPrintFlag(argv: readonly string[]): boolean {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') break

    const name = optionName(arg)

    if (REQUIRED_VALUE_OPTIONS.has(name)) {
      i++
      continue
    }

    if (VARIADIC_OPTIONS.has(name)) {
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith('-') && argv[i + 1] !== '--') {
        i++
      }
      continue
    }

    if (OPTIONAL_VALUE_OPTIONS.has(name)) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        i++
      }
      continue
    }

    if (isPrintFlag(arg)) {
      return true
    }
  }
  return false
}
