import { Command, Option } from '@commander-js/extra-typings'
import {
  PERMISSION_MODES,
  type PermissionMode,
} from './permissions/PermissionMode.js'
import {
  applyMainOptions,
  BYPASS_PERMISSIONS_FLAGS,
  resolvesHeadlessFlags,
} from '../mainCliOptions.js'

/**
 * Result of parsing the flags of a `claude ssh <host> [dir] …` invocation,
 * before the main command is run. Extracted from main.tsx so the parsing is
 * unit-testable.
 */
export interface SshFlagParse {
  host: string | undefined
  cwd: string | undefined
  local: boolean
  /**
   * Narrowed to the known modes: the pre-parse registers this option with
   * `.choices(PERMISSION_MODES)`, so an invalid value throws and the whole
   * route is abandoned — nothing outside the union can reach a caller.
   */
  permissionMode: PermissionMode | undefined
  dangerouslySkipPermissions: boolean
  /** True when commander resolved -p/--print (headless), incl. bundled shorts. */
  headless: boolean
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
  headless: false,
  extraCliArgs: [],
  forwardToMain: [],
})

/**
 * The FULL option set: every main option plus the ssh-only `--local`.
 *
 * Built in one place because the correctness argument in this file rests on the
 * three users of it — the end-of-options boundary probe, the authoritative
 * `mainOpts` read, and the help-detection retry — seeing an IDENTICAL set. A
 * divergent copy would silently break the comparisons those make against the
 * ssh-side parses.
 */
function fullOptionCommand() {
  return applyMainOptions(new Command())
    .option('--local')
    .allowUnknownOption()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
}

/**
 * Whether the FULL option set (every main option plus the ssh-only `--local`)
 * rejects these tokens.
 *
 * NOTE: each call pays a complete option registration (~150 options). That is
 * fine for the handful of probes an ssh line needs — two per `--`, two per short
 * occurrence — but a future loop over every token would multiply it silently.
 *
 * Rejects these tokens — used only to compare two prefixes, never to report an
 * error, which the real parse does.
 */
function fullParseThrows(prefix: readonly string[]): boolean {
  const cmd = fullOptionCommand()
  try {
    cmd.parseOptions([...prefix])
    return false
  } catch {
    return true
  }
}

/**
 * Index of the end-of-options marker, or -1 when the line has none.
 *
 * A `--` is the marker unless an option consumed it as its VALUE, which is
 * asked of commander rather than a hand-maintained list of value-taking flags:
 * drop the `--` and, if an option is left without its required value (the parse
 * now fails) while keeping it parses cleanly, that option had swallowed it.
 *
 * Comparing the two prefixes — rather than inspecting the stored value for a
 * literal `--` — matters because an argParser can discard the raw text
 * (`--debug-file <path>` resolves to `true`), and because a `--` swallowed
 * EARLIER on the line must not mask a later genuine marker.
 */
function endOfOptionsIndex(tokens: readonly string[]): number {
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== '--') continue
    const consumedAsValue =
      fullParseThrows(tokens.slice(0, i)) && !fullParseThrows(tokens.slice(0, i + 1))
    if (consumedAsValue) continue
    return i
  }
  return -1
}

/**
 * The ssh-side option set, in one of two variants — see parseSshFlags for why
 * both are needed.
 *
 * `forPositionals` registers the flags that exist purely so commander keeps
 * COLLECTING OPERANDS past them (it stops at the first token it doesn't know):
 * the bypass flag and the bare `-c` short. The lean variant must NOT know them,
 * because there they would CLAIM tokens: the bypass flag would swallow one
 * sitting in a main option's value slot, and `-c` would read a dash-prefixed
 * value like `--mcp-config -c.json` as a cluster and forge a --continue.
 */
function sshOnlyCommand(forPositionals: boolean) {
  const cmd = new Command()
    .option('--local')
    // Same choices as the real ssh command: an invalid mode (including a flag
    // swallowed as the value, `--permission-mode --yolo`) throws here, so we
    // fall through and commander reports the allowed choices instead of routing
    // an ssh session with a bogus mode.
    .addOption(
      new Option('--permission-mode <mode>').choices(PERMISSION_MODES),
    )
    // The short is added only in the positional variant (see above); the lean
    // parse matches a bare `-c` exactly, further down, where no arity reasoning
    // is involved.
    .option(forPositionals ? '-c, --continue' : '--continue')
    .option(forPositionals ? '-r, --resume [value]' : '--resume [value]')
    .option('--model <model>')
    .option('--fallback-model <model>')
    .allowUnknownOption()
    .exitOverride()
    // Silence this throwaway pre-parse's error output; the real `ssh` command
    // parse reports invalid usage to the user, so we must not double-print it.
    .configureOutput({ writeErr: () => {} })
  return forPositionals ? cmd.option(BYPASS_PERMISSIONS_FLAGS) : cmd
}

/**
 * Parse a `claude ssh …` line by SUBTRACTION: a throwaway commander command
 * registers only the ssh-side options, so commander itself claims those (with
 * their values) and hands everything it doesn't recognize back in `unknown`,
 * verbatim. Nothing here re-implements commander's tokenizer — clusters
 * (`-pn notes`), `=` forms (`--print=x`), bare `-` values and dash-prefixed
 * values all pass through exactly as typed, because we never inspect them.
 *
 * host/cwd are the first two positionals commander reports for the pre-`--`
 * head, so a token after `--` can never become the remote `[dir]`.
 *
 * `rawCliArgs` starts with the `ssh` token (i.e. `process.argv.slice(2)`).
 *
 * Note: an unrecognized flag before the host makes commander treat the rest of
 * the line as unknown, so no host is found and the real `ssh` command reports
 * the error — the same outcome as before this alias existed. Put ssh flags
 * after the host (`ssh host --add-dir a b`).
 */
export function parseSshFlags(rawCliArgs: readonly string[]): SshFlagParse {
  // TWO ssh-side parses, differing only in whether the bypass flag is
  // registered. Neither alone is right, and each is used only for what it is
  // provably right about:
  //
  //   forwarding  — `cmd` (bypass NOT registered). Registering it makes
  //                 commander claim a token in a main option's VALUE slot
  //                 (`ssh host --debug-file --yolo`), swallowing the value.
  //                 Unregistered, the token stays in `unknown` and is
  //                 forwarded verbatim.
  //   positionals — `positionalCmd`. An unrecognized flag BEFORE the host makes
  //                 commander stop collecting operands, so without those
  //                 registrations `ssh --yolo host` and `ssh -c host` find no
  //                 host at all and the whole ssh flow is skipped — both
  //                 regressions caught in review (origin/main stripped those
  //                 tokens by index before looking for the host).
  //
  // Whether bypass is actually SET is never taken from either: that comes from
  // the full main option set below, which knows every arity.
  const cmd = sshOnlyCommand(false)
  const positionalCmd = sshOnlyCommand(true)

  // Split at the end-of-options marker: tokens after it are
  // positional data for the local main command, never the remote `[dir]`.
  // Parsing only the head keeps commander from mapping `ssh host -- --yolo`'s
  // trailing token onto operands[1] (i.e. cwd).
  const args = [...rawCliArgs.slice(1)]
  const eooIndex = endOfOptionsIndex(args)
  const head = eooIndex === -1 ? args : args.slice(0, eooIndex)
  const tail = eooIndex === -1 ? [] : args.slice(eooIndex + 1)

  let operands: string[]
  let unknown: string[]
  let positionalOperands: string[]
  let positionalUnknown: string[]
  try {
    ;({ operands, unknown } = cmd.parseOptions([...head]))
    // Both halves are captured here rather than re-parsing later: a second pass
    // over the same instance is idempotent only while no ssh-side option uses a
    // collect accumulator, and nothing should depend on that staying true.
    ;({ operands: positionalOperands, unknown: positionalUnknown } =
      positionalCmd.parseOptions([...head]))
  } catch {
    return noHostResult()
  }
  // Decisions that depend on MAIN-option arity are asked of the main option set,
  // never of the ssh-only parse above: to that parse a main option's VALUE looks
  // like a flag (`--debug-file --help`, `--mcp-config -c`).
  // Registers `--local` too (see fullOptionCommand), so this arity-aware parse
  // can answer for every ssh control — see the value-slot check below.
  const mainParse = fullOptionCommand()
  let mainUnknown: string[] = []
  try {
    ;({ unknown: mainUnknown } = mainParse.parseOptions([...head]))
  } catch {
    // A required value missing at the END of the line (`ssh host --help
    // --settings`) throws before commander returns what it did not recognize,
    // leaving `mainUnknown` empty — and the help short-circuit below reads it,
    // so the route would proceed instead of falling through to `ssh --help`.
    //
    // Retry once with a filler token so the arity is satisfied and commander can
    // report `unknown`. The filler is dash-free, so it can only ever be consumed
    // as that option's value or land as an operand — never mistaken for a flag,
    // and never able to ADD a token to `unknown`. Only the unknown list is taken
    // from the retry; `mainOpts` stays with the original parse, which holds what
    // the user actually typed. The real parse still reports the usage error.
    const retry = fullOptionCommand()
    try {
      ;({ unknown: mainUnknown } = retry.parseOptions([
        ...head,
        'openclaude-missing-value-filler',
      ]))
    } catch {
      // The filler satisfies ARITY, not VALIDATION: an option with `.choices()`
      // or a throwing argParser (`--output-format`, `--effort`, `--thinking`,
      // `--max-turns`, …) rejects it, and commander again never reports what it
      // did not recognize. Fall back to the ssh-side parse, which classifies a
      // help token correctly for its own arities. Only reachable on a line that
      // is already invalid, where rendering usage beats opening a connection.
      mainUnknown = unknown
    }
  }
  const mainOpts = mainParse.opts() as Record<string, unknown>

  // A help request in option position is a no-route signal: fall through so
  // commander's real `ssh` command renders ITS help. A `--help` that is another
  // option's value is not a help request, which is why this consults the main
  // parse rather than the ssh-only one.
  if (mainUnknown.includes('--help') || mainUnknown.includes('-h')) {
    return noHostResult()
  }
  const o = cmd.opts() as Record<string, unknown>

  // The ssh-only parse does not know MAIN option arities, so it can claim a
  // control that is really some main option's VALUE: in `ssh host --settings
  // --local`, commander gives `--local` to `--settings`, but the ssh-only parse
  // sees a flag and would start a LOCAL test session while silently dropping
  // the user's --settings value.
  //
  // The bypass flag avoids this by not being registered in that parse at all;
  // the rest cannot, because they must be claimed (they go to the remote, and
  // `--local` is not a main option, so forwarding it would make the local
  // command reject an unknown option). Instead, compare the two views: the
  // arity-aware parse is authoritative about whether the control is really
  // there. If it disagrees, the line is ambiguous from the ssh side — abandon
  // the route and let the real `ssh` command report usage, exactly as for an
  // invalid --permission-mode or a --help in option position.
  // `continue` is included: the LONG form is registered in the ssh-only parse,
  // so it can be misclaimed from a value slot. A bare `-c` cannot — that short
  // is deliberately unregistered there — so this can only ever fire on a real
  // mis-claim, never on the shortContinue path handled below.
  const misclaimedControls = [
    'local',
    'permissionMode',
    'model',
    'fallbackModel',
    'resume',
    'continue',
  ].filter(
    key => Boolean(o[key]) && !mainOpts[key],
  )
  if (misclaimedControls.length > 0) {
    return noHostResult()
  }

  // ssh/remote-side flags forwarded to the remote spawn.
  // Value-shaped, not position-aware: this asks whether ANY resolved main
  // option value is exactly `-c`, so a line carrying both a real `-c` flag and
  // an unrelated `-c` value (`ssh host -c --mcp-config -c`) suppresses
  // shortContinue. That fails safe — `--continue` is forwarded to the local
  // main command rather than silently claimed for the remote — and precise
  // positions would require re-walking commander's token consumption, which
  // this file exists to avoid.
  // `-c` is ssh-side, but only when commander agrees it is a flag here: in
  // `--mcp-config -c` it is that option's value and must stay in forwardToMain.
  // `mainOpts.continue` alone isn't enough — a long `--continue` elsewhere on
  // the line sets it too, so also require that no main option swallowed a `-c`.
  // Was the token at this index consumed as some option's VALUE? Asked by
  // dropping it and seeing whether the parse then fails for a missing required
  // value — the same probe the end-of-options boundary uses, and for the same
  // reason: inspecting the resolved values misses options whose argParser
  // DISCARDS the raw text (`--debug-file <path>` resolves to `true`), so
  // `ssh host --continue --debug-file -c` looked like a genuine `-c` and its
  // value was stripped out of the forwarded line.
  const isValueSlot = (index: number): boolean =>
    fullParseThrows(head.slice(0, index)) &&
    !fullParseThrows(head.slice(0, index + 1))

  /**
   * Whether this short appears in FLAG position, and nowhere in a value slot.
   * Shared by the `-c` and `-r` checks so a third short cannot drift. Requiring
   * no value-slot occurrence is deliberately conservative: a line carrying both
   * (`ssh host -c --debug-file -c`) forwards the flag to the local command
   * rather than risk stripping the other occurrence, which is a value.
   */
  const hasOnlyFlagPositionOccurrences = (token: string): boolean => {
    const indices = head.flatMap((t, i) => (t === token ? [i] : []))
    return indices.length > 0 && !indices.some(isValueSlot)
  }
  const consumedAsValue = !hasOnlyFlagPositionOccurrences('-c')
  const shortContinue =
    Boolean(mainOpts.continue) && head.includes('-c') && !consumedAsValue
  // Same treatment for `-r`: long-only in the claiming parse (a `-r` there would
  // read `--mcp-config -r.json` as a cluster), so a bare short is recognised via
  // the arity-aware parse instead. Without this the REMOTE lost the resume —
  // origin/main extracted it with indexOf before this refactor.
  const resumeConsumedAsValue = !hasOnlyFlagPositionOccurrences('-r')
  const shortResume =
    mainOpts.resume !== undefined &&
    o.resume === undefined &&
    head.includes('-r') &&
    !resumeConsumedAsValue
  // Whatever commander didn't claim is forwarded verbatim — that IS the
  // subtraction — so the real parse reports typos rather than this throwaway
  // swallowing them. exitOverride() means invalid usage throws above, in which
  // case we fall through and let the real parse report it.
  // Did registering the bypass flag change which positionals commander found?
  // If so, a bypass token stood in FLAG position ahead of the host: the
  // bypass-registered parse is then the accurate view of the whole line, and
  // its `unknown` (which excludes the token it legitimately claimed, and the
  // positionals it collected) is what should be forwarded. Otherwise the two
  // parses agree on positionals and the unregistered parse is authoritative,
  // keeping a value-slot token from being swallowed.
  //
  // Guard: if the main parse attributes a bypass spelling to some option's
  // VALUE, the bypass-registered view cannot be trusted to have claimed only
  // real flags, so stay with the conservative parse — at worst no host is
  // found and the real `ssh` command reports usage, which is the documented
  // outcome for any main-only flag placed before the host.
  // Derived from the constant, never re-listed: an alias added there must not
  // silently slip past this guard.
  const bypassSpellings = new Set(
    BYPASS_PERMISSIONS_FLAGS.split(',')
      .map(flag => flag.trim())
      .filter(flag => flag.startsWith('--')),
  )
  // Detected with the arity probe, not by inspecting resolved VALUES: an
  // argParser can discard the raw text (`--debug-file <path>` resolves to
  // `true`), so a value-shaped check could not see the second `--yolo` in
  // `ssh --yolo host --debug-file --yolo`. The swap then applied, the positional
  // parse claimed that token as a bypass request, and the forwarded line lost
  // --debug-file's argument. Same fix already used for the `-c`/`-r` shorts.
  const bypassInValueSlot = head.some(
    (token, index) => bypassSpellings.has(token) && isValueSlot(index),
  )
  const fullerParseBoundTheHost =
    !bypassInValueSlot && positionalOperands.length > operands.length
  if (fullerParseBoundTheHost) {
    operands = positionalOperands
    unknown = positionalUnknown
  }

  // When the positional parse is the one that bound the host, IT is also the
  // parse that claimed any short cluster (`ssh -cr host`): the lean parse does
  // not register the shorts, and the exact-token checks below never match a
  // cluster. Without crediting it here the cluster reaches neither the remote
  // (extraCliArgs) nor the local command (it is absent from positionalUnknown,
  // which the swap adopts) — it simply disappeared.
  const positionalOpts = positionalCmd.opts() as Record<string, unknown>
  const claimed = fullerParseBoundTheHost ? positionalOpts : o

  const extraCliArgs: string[] = []
  if (claimed.continue || shortContinue) extraCliArgs.push('--continue')
  const resumeValue =
    claimed.resume !== undefined
      ? claimed.resume
      : shortResume
        ? mainOpts.resume
        : undefined
  if (resumeValue !== undefined) {
    extraCliArgs.push('--resume')
    if (typeof resumeValue === 'string') extraCliArgs.push(resumeValue)
  }
  // ALL SIX ssh controls come from `claimed` — continue, resume, model,
  // fallbackModel, local and permissionMode — rather than from `o`.
  //
  // Reading any of them from `o` is correct only while that spelling is
  // long-only in both variants, so the two parses cannot disagree. That is a
  // property of the current registrations, not a rule: registering a short for
  // one in the positional variant would silently lose its value in the cluster
  // case, which is the bug crediting `claimed` was added to fix.
  if (typeof claimed.model === 'string') extraCliArgs.push('--model', claimed.model)
  if (typeof claimed.fallbackModel === 'string') {
    extraCliArgs.push('--fallback-model', claimed.fallbackModel)
  }


  let forwardToMain = shortContinue
    ? unknown.filter(t => t !== '-c')
    : [...unknown]
  // Strip whenever resume was claimed for the remote AT ALL, not only when the
  // short was the source: `-r a --resume b` resolves to `b` from the long form,
  // and leaving the short's span behind would replay it on the local command.
  if (
    resumeValue !== undefined &&
    head.includes('-r') &&
    !resumeConsumedAsValue
  ) {
    // Claimed for the remote above, so it must not also reach the local command.
    // EVERY occurrence is dropped, not just the first: commander keeps the last
    // value (`-r a -r b` resolves to `b`), so removing one span would forward
    // the other. The following token is consumed only when it is not
    // dash-prefixed, which is commander's rule for an OPTIONAL value.
    const kept: string[] = []
    for (let i = 0; i < forwardToMain.length; i += 1) {
      const token = forwardToMain[i]!
      if (token !== '-r') {
        kept.push(token)
        continue
      }
      const next = forwardToMain[i + 1]
      if (next !== undefined && !next.startsWith('-')) i += 1
    }
    forwardToMain = kept
  }
  // Positional data — extra pre-`--` operands plus everything after `--` — is
  // handed to the main command behind a `--` so its parse cannot re-read a
  // token like `--yolo` as a bypass flag (e.g. `ssh host -- --yolo`).
  const positionalTail = [...operands.slice(2), ...tail]
  if (positionalTail.length > 0) forwardToMain.push('--', ...positionalTail)

  return {
    // An empty operand is not a host: `ssh "$HOST" --yolo` with HOST unset used
    // to pass main.tsx's `host !== undefined` route check while failing the
    // Boolean(host) gate that arms the remote-bypass guards, leaving a LOCAL
    // session running every tool bypassing with no remote at all.
    host: operands[0] ? operands[0] : undefined,
    cwd: operands[1],
    local: Boolean(claimed.local),
    // Safe by construction: `.choices(PERMISSION_MODES)` rejected anything
    // else before this point (an invalid mode returns noHostResult above).
    permissionMode:
      typeof claimed.permissionMode === 'string'
        ? (claimed.permissionMode as PermissionMode)
        : undefined,
    // Arity-aware: true only when commander, knowing every main option's
    // arity, resolves the flag as SET — not when it sits in a value slot.
    dangerouslySkipPermissions: Boolean(mainOpts.dangerouslySkipPermissions),
    // -p/--print isn't an ssh-side option, so ask the main option set (still
    // commander, never a token scan): that judges bundled shorts and value
    // positions, and only the pre-`--` head is considered.
    // Resolved through the shared helper, NOT from the mainOpts snapshot:
    // parseOptions stops at a rejected value, so `ssh host --output-format bogus
    // -p` left print unset and silently skipped the headless rejection in
    // main.tsx. resolvesHeadlessFlags strips validation (arity is all that
    // matters for whether -p was passed) and is what every other startup gate
    // uses, so this decision cannot drift from theirs.
    headless: resolvesHeadlessFlags(head).print,
    extraCliArgs,
    forwardToMain,
  }
}
