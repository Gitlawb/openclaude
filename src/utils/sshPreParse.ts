import { Command } from '@commander-js/extra-typings'
import { applyMainOptions } from '../mainCliOptions.js'

/**
 * Result of parsing the flags of a `claude ssh <host> [dir] …` invocation,
 * before the main command is run. Extracted from main.tsx so the parsing is
 * unit-testable.
 */
export interface SshFlagParse {
  host: string | undefined
  cwd: string | undefined
  local: boolean
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
  /** Flags forwarded to the remote CLI's initial spawn (e.g. `--model <m>`). */
  extraCliArgs: string[]
  /** Leftover (local main-command) flags handed to the local main command / TUI. */
  forwardToMain: string[]
}

// Factory (not a shared constant) so each caller gets its own fresh arrays and
// a mutation can't leak between invocations.
const noHostResult = (): SshFlagParse => ({
  host: undefined,
  cwd: undefined,
  local: false,
  permissionMode: undefined,
  dangerouslySkipPermissions: false,
  extraCliArgs: [],
  forwardToMain: [],
})

// Options handled here for the ssh/remote side; everything else the user typed
// is forwarded verbatim to the local main command. Keyed by commander
// attributeName (camelCased long flag).
const SSH_OWN_ATTRS = new Set([
  'local',
  'permissionMode',
  'dangerouslySkipPermissions',
  'continue',
  'resume',
  'model',
  'fallbackModel',
])

/**
 * Parse a `claude ssh …` line with commander so option arity, last-value
 * semantics, `<choices>`, and the `--` end-of-options marker are all handled by
 * the parser rather than a hand-rolled scanner. The throwaway command reuses the
 * MAIN command's full option set (applyMainOptions) plus ssh's own `--local`, so
 * every option's arity is known: a value-bearing main flag (e.g.
 * `ssh --settings foo host`) no longer shifts the host/cwd positionals, and a
 * `--yolo` in a value slot or after `--` cannot be mistaken for a bypass flag.
 *
 * `rawCliArgs` starts with the `ssh` token (i.e. `process.argv.slice(2)`).
 *
 * Note: a *variadic* main flag before the host (e.g. `ssh --add-dir a b host`)
 * greedily consumes the following tokens — that is commander's own behavior, so
 * such a host must come first (`ssh host --add-dir a b`) or after `--`.
 */
export function parseSshFlags(rawCliArgs: readonly string[]): SshFlagParse {
  const cmd = applyMainOptions(new Command())
    .option('--local')
    .allowUnknownOption()
    .exitOverride()
    // Silence this throwaway pre-parse's error output; the real `ssh` command
    // parse reports invalid usage to the user, so we must not double-print it.
    .configureOutput({ writeErr: () => {} })

  // parseOptions separates positionals (host/cwd) from unrecognized options;
  // commander populates opts() with correct arity. exitOverride() throws a
  // CommanderError on invalid usage (e.g. `--model` with no value) — catch it
  // and fall through with no host so the real `ssh` command surfaces the error.
  let operands: string[]
  let unknown: string[]
  try {
    ;({ operands, unknown } = cmd.parseOptions([...rawCliArgs.slice(1)]))
  } catch {
    return noHostResult()
  }
  // A help request in option position (`ssh host --help` / `-h`, but not a
  // `-- --help` positional) is a no-route signal: fall through so commander's
  // real `ssh` command renders ITS help. parseOptions leaves help in `unknown`,
  // and only option-position tokens (before `--`) land there.
  if (unknown.includes('--help') || unknown.includes('-h')) {
    return noHostResult()
  }
  const o = cmd.opts() as Record<string, unknown>

  // ssh/remote-side flags forwarded to the remote spawn.
  const extraCliArgs: string[] = []
  if (o.continue) extraCliArgs.push('--continue')
  if (o.resume !== undefined) {
    extraCliArgs.push('--resume')
    if (typeof o.resume === 'string') extraCliArgs.push(o.resume)
  }
  if (typeof o.model === 'string') extraCliArgs.push('--model', o.model)
  if (typeof o.fallbackModel === 'string') {
    extraCliArgs.push('--fallback-model', o.fallbackModel)
  }

  // Reconstruct every OTHER main option the user actually passed (source 'cli',
  // not defaults) so it is forwarded to the local main command with correct
  // arity — commander re-parses forwardToMain, so token form is not critical.
  const forwardToMain: string[] = []
  for (const opt of cmd.options) {
    const attr = opt.attributeName()
    if (SSH_OWN_ATTRS.has(attr)) continue
    if (cmd.getOptionValueSource(attr) !== 'cli') continue
    const flag = opt.long ?? opt.short
    if (!flag) continue
    const val = o[attr]
    if (opt.negate) {
      forwardToMain.push(flag)
    } else if (val === true) {
      forwardToMain.push(flag)
    } else if (val === false || val === undefined || val === null) {
      // not set / negated-off — nothing to forward
    } else if (Array.isArray(val)) {
      // variadic: one flag then all values; accumulator: repeat the flag.
      if (opt.variadic) {
        forwardToMain.push(flag, ...val.map(String))
      } else {
        for (const v of val) forwardToMain.push(flag, String(v))
      }
    } else {
      forwardToMain.push(flag, String(val))
    }
  }
  // Genuinely unrecognized flags (typos) forward too, so the real parse reports
  // them rather than this throwaway swallowing them.
  forwardToMain.push(...unknown)
  // Positionals beyond host/cwd (including anything after `--`) are positional
  // data; keep them behind a `--` so the main command's parse cannot re-read a
  // token like `--yolo` as a bypass flag (e.g. `ssh host /tmp -- --yolo`).
  const extraOperands = operands.slice(2)
  if (extraOperands.length > 0) forwardToMain.push('--', ...extraOperands)

  return {
    host: operands[0],
    cwd: operands[1],
    local: Boolean(o.local),
    permissionMode:
      typeof o.permissionMode === 'string' ? o.permissionMode : undefined,
    dangerouslySkipPermissions: Boolean(o.dangerouslySkipPermissions),
    extraCliArgs,
    forwardToMain,
  }
}
