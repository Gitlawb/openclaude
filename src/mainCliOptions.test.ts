import { describe, expect, it } from 'bun:test'
import {
  applyMainOptions,
  BYPASS_PERMISSIONS_FLAGS,
  localDangerouslySkipPermissions,
  localPermissionModeCli,
  localResolvedPermissionMode,
  resolvesHeadlessFlags,
  resolvesPrintMode,
} from './mainCliOptions.js'
import { Command } from '@commander-js/extra-typings'
import { isDangerousPermissionMode } from './utils/permissions/PermissionMode.js'
import {
  initialPermissionModeFromCLI,
  isBypassPermissionsModeDisabled,
} from './utils/permissions/permissionSetup.js'

describe('resolvesPrintMode', () => {
  it('detects -p/--print, including inside a bundled short cluster', () => {
    expect(resolvesPrintMode(['-p'])).toBe(true)
    expect(resolvesPrintMode(['--print'])).toBe(true)
    // commander expands `-pv`; a token scan would miss it and misroute.
    expect(resolvesPrintMode(['-pv'])).toBe(true)
    expect(resolvesPrintMode(['cc://server', '-p', 'do a thing'])).toBe(true)
  })

  it(`does not fire when -p sits in another option value slot`, () => {
    // commander consumes `-p` as --settings' required value, so it is data.
    expect(resolvesPrintMode(['cc://server', '--settings', '-p'])).toBe(false)
  })

  it('does not fire for a positional after `--` or when absent', () => {
    expect(resolvesPrintMode(['cc://server', '--', '--print'])).toBe(false)
    expect(resolvesPrintMode(['cc://server'])).toBe(false)
    expect(resolvesPrintMode([])).toBe(false)
  })

  it('does not throw on invalid usage', () => {
    expect(() => resolvesPrintMode(['--model'])).not.toThrow()
    expect(resolvesPrintMode(['--model'])).toBe(false)
  })
})

describe('resolvesPrintMode — parse errors elsewhere on the line', () => {
  it('still reports print mode when a later option is invalid', () => {
    // `-p --model` (missing value) throws in commander, but print was already
    // parsed; returning false here would misroute a headless invocation.
    expect(resolvesPrintMode(['cc://server', '-p', '--model'])).toBe(true)
    // …and an invalid line with no print flag still resolves to false.
    expect(resolvesPrintMode(['cc://server', '--model'])).toBe(false)
  })
})

describe('localDangerouslySkipPermissions (cc:// direct connect)', () => {
  it('suppresses bypass for the LOCAL session while leaving the flag forwardable', () => {
    // The remote executes the tools, so the flag must reach
    // createDirectConnectSession unchanged...
    const rawFlagForRemote = true
    // ...while this local client resolves to a non-bypass mode.
    expect(localDangerouslySkipPermissions(rawFlagForRemote, true)).toBe(false)

    const { mode } = initialPermissionModeFromCLI({
      permissionModeCli: undefined,
      dangerouslySkipPermissions: localDangerouslySkipPermissions(
        rawFlagForRemote,
        true,
      ),
    })
    // Asserted through the backstop, not on the resolver's output directly:
    // initialPermissionModeFromCLI also folds in settings
    // `permissions.defaultMode`, so on a machine or runner configured with
    // bypassPermissions the resolved mode is dangerous even though the FLAG was
    // suppressed — which is precisely why localResolvedPermissionMode exists.
    // The guarantee this suite pins is the end state, and that one really does
    // hold in every environment.
    expect(isDangerousPermissionMode(localResolvedPermissionMode(mode, true))).toBe(
      false,
    )
  })

  it('leaves the flag untouched when there is no pending cc:// connect', () => {
    expect(localDangerouslySkipPermissions(true, false)).toBe(true)
    expect(localDangerouslySkipPermissions(undefined, false)).toBeUndefined()
    expect(localDangerouslySkipPermissions(false, false)).toBe(false)

    // …and that path really does reach a bypassing mode, so the assertion
    // above is not vacuously true.
    // Non-vacuity: the SAME call without suppression reaches a bypassing mode
    // wherever the environment permits bypass at all. Asserted as an equality
    // against that condition rather than a bare `true`, so a machine or CI
    // runner with permissions.disableBypassPermissionsMode (or the Statsig
    // gate) set cannot flake this — initialPermissionModeFromCLI reads both.
    // CLAUDE_CODE_REMOTE also feeds initialPermissionModeFromCLI (it filters
    // settings-based default modes), so a dev shell or runner that exports it
    // could move the resolved mode for reasons unrelated to the bypass gate.
    // Cleared for the assertion and restored even if it fails.
    const remote = process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CODE_REMOTE
    try {
      const { mode } = initialPermissionModeFromCLI({
        permissionModeCli: undefined,
        dangerouslySkipPermissions: localDangerouslySkipPermissions(true, false),
      })
      expect(isDangerousPermissionMode(mode)).toBe(
        !isBypassPermissionsModeDisabled(),
      )
    } finally {
      if (remote !== undefined) process.env.CLAUDE_CODE_REMOTE = remote
    }
  })
})

describe('BYPASS_PERMISSIONS_FLAGS', () => {
  it('keeps the spelling order that makes commander name the attribute', () => {
    // commander derives the attribute from the LAST long flag. If a future edit
    // swaps the spellings, every `opts().dangerouslySkipPermissions` reader in
    // the codebase silently reads `undefined` instead — so pin the order here
    // rather than relying on each of the four registration sites agreeing.
    expect(BYPASS_PERMISSIONS_FLAGS).toBe('--yolo, --dangerously-skip-permissions')

    const parsed = applyMainOptions(new Command())
      .exitOverride()
      .parse(['--yolo'], { from: 'user' })
      .opts() as Record<string, unknown>
    expect(parsed.dangerouslySkipPermissions).toBe(true)
    expect(parsed.yolo).toBeUndefined()

    // The two positions that must NOT grant bypass are decided entirely by
    // commander, so a change in registration order or arity would move them
    // without failing anything else in this suite.
    const inValueSlot = applyMainOptions(new Command())
      .exitOverride()
      .parse(['--settings', '--yolo'], { from: 'user' })
      .opts() as Record<string, unknown>
    expect(inValueSlot.dangerouslySkipPermissions).toBeUndefined()
    expect(inValueSlot.settings).toBe('--yolo')

    const afterMarker = applyMainOptions(new Command())
      // Stated explicitly: commander 12 tolerates the excess operand this line
      // produces, commander 13 errors by default. The precondition belongs in
      // the test rather than in the library version it happens to run against.
      .allowExcessArguments()
      .exitOverride()
      .parse(['--', '--yolo'], { from: 'user' })
      .opts() as Record<string, unknown>
    expect(afterMarker.dangerouslySkipPermissions).toBeUndefined()

    // the canonical spelling resolves to the same attribute
    const canonical = applyMainOptions(new Command())
      .exitOverride()
      .parse(['--dangerously-skip-permissions'], { from: 'user' })
      .opts() as Record<string, unknown>
    expect(canonical.dangerouslySkipPermissions).toBe(true)
  })
})

describe('localPermissionModeCli (the second door to bypass)', () => {
  it('drops a bypassing mode for a pending remote session', () => {
    for (const mode of ['bypassPermissions', 'fullAccess']) {
      expect(localPermissionModeCli(mode, true)).toBeUndefined()
      // …and the resolved local mode is then not dangerous
      const { mode: resolved } = initialPermissionModeFromCLI({
        permissionModeCli: localPermissionModeCli(mode, true),
        dangerouslySkipPermissions: localDangerouslySkipPermissions(true, true),
      })
      // …through the backstop, for the same settings-defaultMode reason as above
      expect(
        isDangerousPermissionMode(localResolvedPermissionMode(resolved, true)),
      ).toBe(false)
    }
  })

  it('leaves non-bypassing modes and local sessions alone', () => {
    expect(localPermissionModeCli('plan', true)).toBe('plan')
    expect(localPermissionModeCli('acceptEdits', true)).toBe('acceptEdits')
    expect(localPermissionModeCli(undefined, true)).toBeUndefined()
    // no pending remote session: nothing is dropped
    expect(localPermissionModeCli('bypassPermissions', false)).toBe(
      'bypassPermissions',
    )
    expect(localPermissionModeCli('fullAccess', false)).toBe('fullAccess')
  })
})

describe('resolvesPrintMode memoization', () => {
  it('never leaks a previous answer across different token lists', () => {
    // The reason the RESULT is cached and not the Command: a reused command
    // keeps its parsed values, so `-p` once would answer true forever. These
    // interleavings would all fail under that mistake.
    expect(resolvesPrintMode(['-p'])).toBe(true)
    expect(resolvesPrintMode(['--verbose'])).toBe(false)
    expect(resolvesPrintMode(['-p'])).toBe(true)
    expect(resolvesPrintMode(['--', '--print'])).toBe(false)
    expect(resolvesPrintMode(['-pv'])).toBe(true)
    expect(resolvesPrintMode([])).toBe(false)
    expect(resolvesPrintMode(['--print'])).toBe(true)
    expect(resolvesPrintMode(['--settings', '-p'])).toBe(false)
  })

  it('returns the same answer when asked repeatedly (cache hit path)', () => {
    for (const tokens of [['-p'], ['--', '--print'], ['--settings', '-p']]) {
      const first = resolvesPrintMode(tokens)
      expect(resolvesPrintMode(tokens)).toBe(first)
      expect(resolvesPrintMode([...tokens])).toBe(first)
    }
  })
})

describe('localResolvedPermissionMode (the third door: settings defaultMode)', () => {
  it('downgrades a dangerous RESOLVED mode for a pending remote session', () => {
    // permissions.defaultMode in settings is folded in by
    // initialPermissionModeFromCLI itself — ungated by either CLI input — so it
    // can only be neutralized on the way out.
    for (const mode of ['bypassPermissions', 'fullAccess'] as const) {
      expect(localResolvedPermissionMode(mode, true)).toBe('default')
      expect(isDangerousPermissionMode(localResolvedPermissionMode(mode, true))).toBe(
        false,
      )
    }
  })

  it('leaves non-bypassing modes and local sessions untouched', () => {
    for (const mode of ['default', 'plan', 'acceptEdits', 'auto'] as const) {
      expect(localResolvedPermissionMode(mode, true)).toBe(mode)
      expect(localResolvedPermissionMode(mode, false)).toBe(mode)
    }
    // a local session keeps its dangerous mode — this guard is remote-only
    expect(localResolvedPermissionMode('bypassPermissions', false)).toBe(
      'bypassPermissions',
    )
    expect(localResolvedPermissionMode('fullAccess', false)).toBe('fullAccess')
  })

  it('closes every door together', () => {
    // all three sources asking for bypass at once, on a remote session
    const { mode } = initialPermissionModeFromCLI({
      permissionModeCli: localPermissionModeCli('bypassPermissions', true),
      dangerouslySkipPermissions: localDangerouslySkipPermissions(true, true),
    })
    expect(isDangerousPermissionMode(localResolvedPermissionMode(mode, true))).toBe(
      false,
    )
  })
})

describe('resolvesHeadlessFlags — the other two routing flags', () => {
  it('honours the end-of-options marker and value slots for all three', () => {
    // initOnly and sdkUrl gate interactivity exactly like print, so the two
    // shapes that matter for them are the same: a post-`--` positional and a
    // token sitting in another option's value slot.
    expect(resolvesHeadlessFlags(['--', '--init-only']).initOnly).toBe(false)
    expect(resolvesHeadlessFlags(['--settings', '--init-only']).initOnly).toBe(false)
    expect(resolvesHeadlessFlags(['--', '--sdk-url', 'x']).sdkUrl).toBe(false)
    expect(resolvesHeadlessFlags(['--settings', '--sdk-url']).sdkUrl).toBe(false)

    // …and the genuine forms, including `=` which the old startsWith() scan
    // matched and commander also resolves
    expect(resolvesHeadlessFlags(['--init-only']).initOnly).toBe(true)
    expect(resolvesHeadlessFlags(['--sdk-url', 'x']).sdkUrl).toBe(true)
    expect(resolvesHeadlessFlags(['--sdk-url=x']).sdkUrl).toBe(true)

    // the three are independent — one being set must not imply the others
    const onlyPrint = resolvesHeadlessFlags(['-p'])
    expect(onlyPrint).toEqual({ print: true, initOnly: false, sdkUrl: false })
    const none = resolvesHeadlessFlags(['--verbose'])
    expect(none).toEqual({ print: false, initOnly: false, sdkUrl: false })
  })
})

describe('resolvesHeadlessFlags — a rejected VALUE earlier on the line', () => {
  it('does not swallow the routing flag that follows it', () => {
    // commander aborts the whole parse at a .choices()/argParser rejection, so
    // reading opts() afterwards missed anything later on the line. These all
    // resolved false before, silently reversing six startup gates: early-input
    // capture would enable raw mode on a headless run, and a provider-config
    // error would degrade from exit(1) to a warning.
    expect(resolvesHeadlessFlags(['--output-format', 'bogus', '-p']).print).toBe(true)
    expect(resolvesHeadlessFlags(['--thinking', 'bogus', '-p']).print).toBe(true)
    expect(resolvesHeadlessFlags(['--effort', 'bogus', '-p']).print).toBe(true)
    expect(resolvesHeadlessFlags(['--permission-mode', 'nope', '-p']).print).toBe(true)
    expect(
      resolvesHeadlessFlags(['--thinking', 'bogus', '--init-only']).initOnly,
    ).toBe(true)
    expect(
      resolvesHeadlessFlags(['--thinking', 'bogus', '--sdk-url', 'x']).sdkUrl,
    ).toBe(true)

    // …and a valid value still behaves, including the end-of-options case that
    // must stay false
    expect(resolvesHeadlessFlags(['--output-format', 'json', '-p']).print).toBe(true)
    expect(resolvesHeadlessFlags(['--', '--print']).print).toBe(false)
  })
})
