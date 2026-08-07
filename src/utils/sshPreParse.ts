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
 * Value-taking flags are extracted before dangerous-skip tokens are stripped,
 * and they consume the next token unconditionally — matching commander's
 * required-argument behavior. This prevents a value that looks like a flag
 * (e.g. `--model --print` or `--permission-mode --local`) from being left in
 * the remaining argv and misinterpreted by later guards.
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

  const localIdx = args.indexOf('--local')
  if (localIdx !== -1) {
    local = true
    args.splice(localIdx, 1)
  }

  const pmIdx = args.indexOf('--permission-mode')
  const pmVal = pmIdx !== -1 ? args[pmIdx + 1] : undefined
  if (pmVal !== undefined) {
    permissionMode = pmVal
    args.splice(pmIdx, 2)
  }
  const pmEqIdx = args.findIndex(a => a.startsWith('--permission-mode='))
  if (pmEqIdx !== -1) {
    permissionMode = args[pmEqIdx]!.split('=')[1]
    args.splice(pmEqIdx, 1)
  }

  const extractFlag = (flag: string, opts: { hasValue?: boolean; as?: string } = {}) => {
    const i = args.indexOf(flag)
    if (i !== -1) {
      extraCliArgs.push(opts.as ?? flag)
      const val = args[i + 1]
      // Consume the next token unconditionally for value-taking flags, matching
      // commander's required-argument behavior.
      if (opts.hasValue && val !== undefined) {
        extraCliArgs.push(val)
        args.splice(i, 2)
      } else {
        args.splice(i, 1)
      }
    }
    const eqI = args.findIndex(a => a.startsWith(`${flag}=`))
    if (eqI !== -1) {
      extraCliArgs.push(opts.as ?? flag, args[eqI]!.slice(flag.length + 1))
      args.splice(eqI, 1)
    }
  }
  extractFlag('-c', { as: '--continue' })
  extractFlag('--continue')
  extractFlag('--resume', { hasValue: true })
  extractFlag('--model', { hasValue: true })
  extractFlag('--fallback-model', { hasValue: true })

  // Every value-taking flag has now consumed its value, so any remaining
  // dangerous-skip token is a genuine standalone bypass flag.
  if (hasDangerousSkipFlag(args)) {
    dangerouslySkipPermissions = true
    args.splice(0, args.length, ...stripDangerousSkipFlags(args))
  }

  return {
    local,
    permissionMode,
    dangerouslySkipPermissions,
    extraCliArgs,
    remaining: [...args, ...trailing],
  }
}
