import { hasDangerousSkipFlag, stripDangerousSkipFlags } from './dangerousSkipFlags.js'

/**
 * Result of pre-parsing the flags of a `claude ssh …` invocation, before the
 * host/cwd positionals and the argv rewrite. Extracted from main.tsx so the
 * security-sensitive arity handling can be unit-tested.
 */
export interface SshFlagParse {
  local: boolean
  permissionMode: string | undefined
  dangerouslySkipPermissions: boolean
  /** Flags to forward to the remote CLI's initial spawn (e.g. --model <m>). */
  extraCliArgs: string[]
  /** `args` with every consumed flag removed; still starts with `ssh`. */
  remaining: string[]
}

/**
 * Pull SSH-relevant flags out of `rawCliArgs` (which starts with `ssh`).
 *
 * Recognized options are parsed in a single left-to-right arity-aware pass.
 * Value-taking flags consume the next token unconditionally — matching
 * commander's required-argument behavior — so a value that looks like a flag
 * (e.g. `--model --print` or `--permission-mode --local`) is never left in the
 * remaining argv to be misinterpreted by later guards. Every occurrence of a
 * recognized option, including equals forms, is consumed.
 *
 * If a value-taking flag has no available value (it is the last pre-`--` token,
 * or the equals form has no `=` delimiter), the option token is left in
 * `remaining` so commander can surface the missing-required-argument error.
 *
 * Tokens at/after `--` are positional and are never parsed as flags.
 */
export function parseSshFlags(rawCliArgs: readonly string[]): SshFlagParse {
  // Honor the `--` end-of-options marker: tokens at/after it are positional and
  // must not be parsed as flags (so `ssh host -- --yolo` / `ssh host -- --local`
  // stay positional and cannot escalate). This is unambiguous here because the
  // `ssh` subcommand registers no variadic options that could consume `--` as a
  // value — unlike the shared dangerous-skip helper used against the main
  // command, which deliberately does NOT split on `--`.
  const all = [...rawCliArgs]
  const eoo = all.indexOf('--')
  const trailing = eoo === -1 ? [] : all.splice(eoo)
  const args = all

  let local = false
  let permissionMode: string | undefined
  let dangerouslySkipPermissions = false
  const extraCliArgs: string[] = []
  const remaining: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!

    if (arg === '--local') {
      local = true
      continue
    }

    if (arg === '-c' || arg === '--continue') {
      extraCliArgs.push('--continue')
      continue
    }

    if (arg === '--permission-mode') {
      if (i + 1 < args.length) {
        permissionMode = args[++i]
        continue
      }
      remaining.push(arg)
      continue
    }
    if (arg.startsWith('--permission-mode=')) {
      permissionMode = arg.slice('--permission-mode='.length)
      continue
    }

    if (arg === '--resume') {
      // Commander declares `--resume [value]`: a bare flag opens the resume
      // picker, and a value is used only when it is a non-option token.
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        extraCliArgs.push('--resume', args[++i])
      } else {
        extraCliArgs.push('--resume')
      }
      continue
    }
    if (arg.startsWith('--resume=')) {
      // Equals form explicitly provides a value, including flag-like values.
      extraCliArgs.push('--resume', arg.slice('--resume='.length))
      continue
    }

    if (arg === '--model') {
      if (i + 1 < args.length) {
        extraCliArgs.push('--model', args[++i])
        continue
      }
      remaining.push(arg)
      continue
    }
    if (arg.startsWith('--model=')) {
      extraCliArgs.push('--model', arg.slice('--model='.length))
      continue
    }

    if (arg === '--fallback-model') {
      if (i + 1 < args.length) {
        extraCliArgs.push('--fallback-model', args[++i])
        continue
      }
      remaining.push(arg)
      continue
    }
    if (arg.startsWith('--fallback-model=')) {
      extraCliArgs.push('--fallback-model', arg.slice('--fallback-model='.length))
      continue
    }

    remaining.push(arg)
  }

  // Every value-taking flag has now consumed its value, so any remaining
  // dangerous-skip token is a genuine standalone bypass flag.
  if (hasDangerousSkipFlag(remaining)) {
    dangerouslySkipPermissions = true
    const stripped = stripDangerousSkipFlags(remaining)
    remaining.length = 0
    remaining.push(...stripped)
  }

  return {
    local,
    permissionMode,
    dangerouslySkipPermissions,
    extraCliArgs,
    remaining: [...remaining, ...trailing],
  }
}
