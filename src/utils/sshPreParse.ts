import { hasDangerousSkipFlag, isDangerousSkipFlag, stripDangerousSkipFlags } from './dangerousSkipFlags.js'

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
 * Value-taking flags are extracted BEFORE dangerous-skip (`--yolo` /
 * `--dangerously-skip-permissions`) tokens are stripped, and they consume a
 * dangerous-skip token that sits in their value position. Otherwise
 * `ssh host --permission-mode --yolo` would strip `--yolo` as a bypass flag —
 * escalating to permission bypass while leaving `--permission-mode` valueless —
 * whereas commander parses `--yolo` as the (invalid) mode value and rejects it.
 */
export function parseSshFlags(rawCliArgs: readonly string[]): SshFlagParse {
  const args = [...rawCliArgs]
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
  if (pmVal !== undefined && (!pmVal.startsWith('-') || isDangerousSkipFlag(pmVal))) {
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
      // Consume a dangerous-skip token in the value slot (see the doc comment)
      // so it is not later mistaken for a bypass flag.
      if (opts.hasValue && val !== undefined && (!val.startsWith('-') || isDangerousSkipFlag(val))) {
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

  return { local, permissionMode, dangerouslySkipPermissions, extraCliArgs, remaining: args }
}
