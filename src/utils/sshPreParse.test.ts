import { describe, expect, it } from 'bun:test'
import { Command } from '@commander-js/extra-typings'
import { parseSshFlags } from './sshPreParse.js'
import { applyMainOptions, resolvesPrintMode } from '../mainCliOptions.js'

/** What the local main command makes of a token list (bypass + settings). */
function mainReads(tokens: readonly string[]): {
  settings: unknown
  bypass: boolean
} {
  const cmd = applyMainOptions(new Command())
    .allowUnknownOption()
    .exitOverride()
    .configureOutput({ writeErr: () => {} })
  try {
    cmd.parseOptions([...tokens])
  } catch {
    // an invalid value still leaves the flags parsed so far readable
  }
  const opts = cmd.opts() as Record<string, unknown>
  return { settings: opts.settings, bypass: Boolean(opts.dangerouslySkipPermissions) }
}

describe('parseSshFlags (commander-authoritative, reuses main option arities)', () => {
  it('extracts host, cwd, and permission-mode without enabling bypass', () => {
    const r = parseSshFlags(['ssh', 'host', '/tmp', '--permission-mode', 'plan'])
    expect(r.host).toBe('host')
    expect(r.cwd).toBe('/tmp')
    expect(r.permissionMode).toBe('plan')
    expect(r.dangerouslySkipPermissions).toBe(false)
  })

  it('accepts ssh flags before the host positional', () => {
    const r = parseSshFlags(['ssh', '--permission-mode', 'plan', 'host'])
    expect(r.host).toBe('host')
    expect(r.permissionMode).toBe('plan')
  })

  it('does not guess a host after an unrecognized flag (no wrong-host connect)', () => {
    // commander treats the rest of the line as unknown once it meets a flag the
    // ssh side doesn't own, so no host is found and the real `ssh` command
    // reports the error — never a connection to the flag's value.
    const r = parseSshFlags(['ssh', '--settings', 'foo.json', 'target-host'])
    expect(r.host).toBeUndefined()
    expect(r.dangerouslySkipPermissions).toBe(false)
  })

  it('forwards a value-bearing MAIN flag placed after the host', () => {
    const r = parseSshFlags(['ssh', 'host', '--settings', 'foo.json'])
    expect(r.host).toBe('host')
    expect(r.cwd).toBeUndefined()
    expect(r.forwardToMain).toEqual(['--settings', 'foo.json'])
  })

  it('a variadic MAIN flag before the host greedily consumes it (commander behavior)', () => {
    // `--add-dir <dirs...>` is variadic, so `ssh --add-dir a b host` has no host
    // (all three are dirs). parseSshFlags returns no host → main falls through to
    // the real ssh command, which errors instead of connecting to a wrong host.
    const r = parseSshFlags(['ssh', '--add-dir', 'a', 'b', 'target-host'])
    expect(r.host).toBeUndefined()
  })

  it('forwards a variadic MAIN flag placed after the host', () => {
    const r = parseSshFlags(['ssh', 'host', '--add-dir', 'a', 'b'])
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual(['--add-dir', 'a', 'b'])
  })

  it('enables bypass for a genuine standalone --yolo / canonical flag', () => {
    const yolo = parseSshFlags(['ssh', 'host', '--yolo'])
    expect(yolo.dangerouslySkipPermissions).toBe(true)
    const canonical = parseSshFlags(['ssh', 'host', '--dangerously-skip-permissions'])
    expect(canonical.dangerouslySkipPermissions).toBe(true)
    // The token is FORWARDED verbatim. The ssh parse no longer registers the
    // bypass option (it would misclaim a main option's value — see the
    // value-slot suite below), so nothing removes it from argv. The local
    // session is kept out of bypass at the permission-mode computation
    // instead: localDangerouslySkipPermissions(flag, isPendingRemoteSession)
    // in main.tsx, the same mechanism the cc:// path uses.
    expect(yolo.forwardToMain).toEqual(['--yolo'])
    expect(canonical.forwardToMain).toEqual(['--dangerously-skip-permissions'])
  })

  it('rejects an invalid --permission-mode instead of routing with it', () => {
    // commander consumes the next token as the required value, then its
    // .choices() rejects it — so we fall through and the real ssh command
    // reports the allowed modes. A --yolo swallowed there is never a bypass.
    for (const bad of ['--yolo', 'notamode']) {
      const r = parseSshFlags(['ssh', 'host', '--permission-mode', bad])
      expect(r.host).toBeUndefined()
      expect(r.permissionMode).toBeUndefined()
      expect(r.dangerouslySkipPermissions).toBe(false)
    }
    // A valid mode still routes.
    const ok = parseSshFlags(['ssh', 'host', '--permission-mode', 'plan'])
    expect(ok.host).toBe('host')
    expect(ok.permissionMode).toBe('plan')
  })

  it('does NOT enable bypass for a --yolo positional after --', () => {
    const r = parseSshFlags(['ssh', 'host', '/tmp', '--', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.host).toBe('host')
    expect(r.cwd).toBe('/tmp')
    expect(r.forwardToMain).toEqual(['--', '--yolo'])
  })

  it('forwards a repeated option verbatim (the main parse applies last-value)', () => {
    const r = parseSshFlags(['ssh', 'host', '--settings', 'a', '--settings', 'b'])
    expect(r.forwardToMain).toEqual(['--settings', 'a', '--settings', 'b'])
  })

  it('forwards ssh model/resume/continue to the remote, not the local main', () => {
    const r = parseSshFlags(['ssh', 'host', '--model', 'gpt', '--continue'])
    expect(r.host).toBe('host')
    expect(r.extraCliArgs).toEqual(['--continue', '--model', 'gpt'])
    expect(r.forwardToMain).toEqual([])
  })

  it('parses --local (ssh-side flag, not forwarded to the main command)', () => {
    const r = parseSshFlags(['ssh', '--local', 'host'])
    expect(r.local).toBe(true)
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual([])
    expect(parseSshFlags(['ssh', 'host']).local).toBe(false)
  })

  it('forwards local main flags (e.g. --debug) to the main command', () => {
    const r = parseSshFlags(['ssh', 'host', '--debug'])
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual(['--debug'])
  })

  it('treats --help/-h in option position as a no-route signal', () => {
    expect(parseSshFlags(['ssh', 'host', '--help']).host).toBeUndefined()
    expect(parseSshFlags(['ssh', 'host', '-h']).host).toBeUndefined()
    // but --help after -- is positional, so the ssh flow still routes
    expect(parseSshFlags(['ssh', 'host', '--', '--help']).host).toBe('host')
  })

  it('returns no host when none is given', () => {
    expect(parseSshFlags(['ssh', '--help']).host).toBeUndefined()
    expect(parseSshFlags(['ssh']).host).toBeUndefined()
  })

  it('does not throw on invalid usage; falls through with no host', () => {
    expect(() => parseSshFlags(['ssh', 'host', '--model'])).not.toThrow()
    expect(parseSshFlags(['ssh', 'host', '--model']).host).toBeUndefined()
  })

  it('emits nothing to stderr on invalid usage (no duplicate diagnostics)', () => {
    const originalWrite = process.stderr.write
    let captured = ''
    process.stderr.write = ((chunk: unknown) => {
      captured += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      parseSshFlags(['ssh', 'host', '--model'])
    } finally {
      process.stderr.write = originalWrite
    }
    expect(captured).toBe('')
  })
})

describe('parseSshFlags — forwarded token fidelity', () => {
  it('forwards --chrome without also emitting --no-chrome', () => {
    // --chrome/--no-chrome share one commander attribute, so both Option
    // instances report source 'cli'; only the matching polarity may forward.
    const on = parseSshFlags(['ssh', 'host', '--chrome'])
    expect(on.forwardToMain).toEqual(['--chrome'])
    const off = parseSshFlags(['ssh', 'host', '--no-chrome'])
    expect(off.forwardToMain).toEqual(['--no-chrome'])
  })

  it('preserves values of options whose parser coerces to true', () => {
    // --debug/--debug-file coerce to `true`, but utils/debug.ts reads the raw
    // argv, so the value and its exact form must survive forwarding.
    expect(parseSshFlags(['ssh', 'host', '--debug=api,hooks']).forwardToMain).toEqual([
      '--debug=api,hooks',
    ])
    expect(
      parseSshFlags(['ssh', 'host', '--debug-file', '/tmp/x.log']).forwardToMain,
    ).toEqual(['--debug-file', '/tmp/x.log'])
  })
})

describe('parseSshFlags — optional-arg options mirror commander', () => {
  it('an optional-arg flag consumes the next token exactly as commander does', () => {
    // commander's `--debug [filter]` consumes a following non-dash token, so
    // `ssh --debug host` has NO host (it became the filter) and falls through
    // to the real ssh command — the forwarded pairing matches that consumption.
    const before = parseSshFlags(['ssh', '--debug', 'host'])
    expect(before.host).toBeUndefined()

    // After the host, the same rule applies to the following token.
    const after = parseSshFlags(['ssh', 'host', '--debug', '/tmp'])
    expect(after.host).toBe('host')
    expect(after.cwd).toBeUndefined()
    expect(after.forwardToMain).toEqual(['--debug', '/tmp'])

    // With nothing to consume, the bare flag forwards alone.
    expect(parseSshFlags(['ssh', 'host', '--debug']).forwardToMain).toEqual([
      '--debug',
    ])
  })
})

describe('parseSshFlags — dash-prefixed required values', () => {
  it('never mistakes a dash-prefixed VALUE for an ssh-side short', () => {
    // `-c.json` is --mcp-config's value, not --continue.
    const r = parseSshFlags(['ssh', 'host', '--mcp-config', '-c.json'])
    expect(r.extraCliArgs).toEqual([])
    expect(r.forwardToMain).toEqual(['--mcp-config', '-c.json'])
  })

  it('forwards a dash-prefixed required value (jatmn P2)', () => {
    // commander consumes a required value unconditionally, so `-foo` is the
    // path here; dropping it would make the main parse fail "argument missing".
    const r = parseSshFlags(['ssh', 'host', '--debug-file', '-foo'])
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual(['--debug-file', '-foo'])
  })

  it('does not steal a following option as an OPTIONAL arg value', () => {
    // `--debug [filter]` must not swallow `--verbose`; both forward separately.
    const r = parseSshFlags(['ssh', 'host', '--debug', '--verbose'])
    expect(r.forwardToMain).toContain('--debug')
    expect(r.forwardToMain).toContain('--verbose')
  })
})

describe('parseSshFlags — repeated coerced options', () => {
  it('forwards every occurrence verbatim, letting the main parse pick last', () => {
    // Pass-through (not reconstruction) keeps the exact `=` form and both
    // occurrences; the local main command re-parses and applies last-value.
    const r = parseSshFlags(['ssh', 'host', '--debug=api', '--debug=hooks'])
    expect(r.forwardToMain).toEqual(['--debug=api', '--debug=hooks'])
  })
})

describe('parseSshFlags — bundled short flags', () => {
  it('forwards a bundled short cluster instead of dropping it', () => {
    // commander expands `-pv` itself (nothing lands in `unknown`), so an
    // exact-match-only walk would silently drop it.
    const r = parseSshFlags(['ssh', 'host', '-pv'])
    expect(r.host).toBe('host')
    // Forwarded verbatim — the local parse expands the cluster itself.
    expect(r.forwardToMain).toEqual(['-pv'])
  })

  it('claims a bare -c but leaves clusters verbatim', () => {
    // `-c` alone is ssh-side (goes to the remote). A cluster is passed through
    // untouched, exactly as before this alias existed — expanding it here would
    // mean re-implementing commander's tokenizer.
    expect(parseSshFlags(['ssh', 'host', '-c']).extraCliArgs).toEqual(['--continue'])
    expect(parseSshFlags(['ssh', 'host', '-c']).forwardToMain).toEqual([])
    // Both halves of the cluster's routing are pinned: it is forwarded whole,
    // so its `-c` applies --continue LOCALLY and nothing is sent to the remote.
    // Asserting only forwardToMain would let a future change that starts
    // expanding clusters flip the routing without failing this test.
    expect(parseSshFlags(['ssh', 'host', '-cr']).forwardToMain).toEqual(['-cr'])
    expect(parseSshFlags(['ssh', 'host', '-cr']).extraCliArgs).toEqual([])
  })

})

describe('parseSshFlags — dual-long options', () => {
  it('forwards either spelling of a dual-long option with its value', () => {
    // `--allowedTools, --allowed-tools <tools...>`: commander keeps the second
    // spelling in Option.long and the first in Option.short, so both are matched
    // and neither the flag nor its value can be dropped or shift the host.
    for (const flag of ['--allowedTools', '--allowed-tools']) {
      const r = parseSshFlags(['ssh', 'host', flag, 'Edit'])
      expect(r.host).toBe('host')
      expect(r.cwd).toBeUndefined()
      expect(r.forwardToMain).toEqual([flag, 'Edit'])
    }
    const d = parseSshFlags(['ssh', 'host', '--disallowedTools', 'Bash'])
    expect(d.forwardToMain).toEqual(['--disallowedTools', 'Bash'])
  })
})

describe('parseSshFlags — post-`--` operands are never the remote cwd (jatmn P1)', () => {
  it('forwards post-`--` data instead of mapping it onto cwd', () => {
    for (const token of ['--yolo', '--print', '-p', 'prompt']) {
      const r = parseSshFlags(['ssh', 'host', '--', token])
      expect(r.host).toBe('host')
      expect(r.cwd).toBeUndefined()
      expect(r.forwardToMain).toEqual(['--', token])
      expect(r.dangerouslySkipPermissions).toBe(false)
      expect(r.headless).toBe(false)
    }
  })

  it('still takes a genuine pre-`--` positional as cwd', () => {
    const r = parseSshFlags(['ssh', 'host', '/tmp', '--', '--yolo'])
    expect(r.cwd).toBe('/tmp')
    expect(r.forwardToMain).toEqual(['--', '--yolo'])
  })
})

describe('parseSshFlags — variadic dash-prefixed values (jatmn P2)', () => {
  it('forwards a dash-prefixed first value like commander consumes it', () => {
    // commander: `--add-dir -foo` → addDir: ['-foo']; dropping it would leave
    // the local parse missing a required value.
    expect(parseSshFlags(['ssh', 'host', '--add-dir', '-foo']).forwardToMain).toEqual([
      '--add-dir',
      '-foo',
    ])
    expect(parseSshFlags(['ssh', 'host', '--tools', '-x']).forwardToMain).toEqual([
      '--tools',
      '-x',
    ])
  })

  it('still collects multiple non-dash variadic values', () => {
    expect(parseSshFlags(['ssh', 'host', '--add-dir', 'a', 'b']).forwardToMain).toEqual([
      '--add-dir',
      'a',
      'b',
    ])
  })
})

describe('parseSshFlags — a `--` consumed as an ssh option value', () => {
  it('is not treated as the end-of-options marker', () => {
    // commander gives `--model` the `--` as its value, so what follows is a
    // normal token — not positional data behind a marker.
    const m = parseSshFlags(['ssh', 'host', '--model', '--'])
    expect(m.extraCliArgs).toEqual(['--model', '--'])
    expect(m.cwd).toBeUndefined()

    // …so the next token is still an ordinary positional (the remote cwd).
    const withCwd = parseSshFlags(['ssh', 'host', '--model', '--', 'x'])
    expect(withCwd.cwd).toBe('x')

    // For an option with .choices(), swallowing `--` makes the value invalid,
    // so the route is abandoned and the real ssh command reports the choices —
    // and critically the trailing --yolo never becomes a silent bypass.
    const bad = parseSshFlags(['ssh', 'host', '--permission-mode', '--', '--yolo'])
    expect(bad.host).toBeUndefined()
    expect(bad.dangerouslySkipPermissions).toBe(false)
  })
})

describe('parseSshFlags — a `--` consumed by a MAIN-only required-value option', () => {
  // `--settings`/`--system-prompt`/… take a required value, and commander will
  // give them a following `--` as that value. The `--` is therefore NOT an
  // end-of-options marker, so the `--yolo` after it sits in genuine option
  // position: the remote session must be granted bypass, matching what
  // commander resolves for the identical tokens with no `ssh` in front.
  //
  // The end-of-options boundary is derived from the full option arities for
  // exactly this reason — an earlier version used a hand-listed set of
  // value-taking flags, split here, and computed the remote bypass as false
  // while commander said true (caught in review).
  // --debug-file is included deliberately: its argParser returns `true` and
  // discards the raw text, so a check that looked for a stored literal `--`
  // would miss it. The boundary test compares parse failures instead.
  for (const flag of [
    '--settings',
    '--system-prompt',
    '--session-id',
    '--debug-file',
    '--mcp-config',
  ]) {
    it(`grants remote bypass for \`${flag} -- --yolo\`, matching commander`, () => {
      const userTokens = [flag, '--', '--yolo']
      const r = parseSshFlags(['ssh', 'host', ...userTokens])

      expect(r.host).toBe('host')
      expect(r.cwd).toBeUndefined()
      // commander gives the `--` to the required-value option, so this `--yolo`
      // is a real flag — the remote session gets bypass
      expect(r.dangerouslySkipPermissions).toBe(true)
      expect(mainReads(userTokens).bypass).toBe(true)
      // the split still round-trips: what main receives is what the user typed
      expect(r.forwardToMain).toEqual(userTokens)
      expect(mainReads(r.forwardToMain)).toEqual(mainReads(userTokens))
    })
  }

  it('still treats a genuine end-of-options `--` as an escape', () => {
    // no option is waiting for a value, so this `--` IS the marker: the trailing
    // token is positional data and must not grant bypass anywhere.
    const r = parseSshFlags(['ssh', 'host', '--', '--yolo'])
    expect(r.host).toBe('host')
    expect(r.cwd).toBeUndefined()
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.forwardToMain).toEqual(['--', '--yolo'])
  })

  it('does not let an earlier swallowed `--` mask a later real marker', () => {
    // `--settings` eats the first `--`; the second is a genuine marker, so the
    // trailing --yolo is positional and grants nothing.
    const r = parseSshFlags(['ssh', 'host', '--settings', '--', '--', '--yolo'])
    expect(r.host).toBe('host')
    expect(r.dangerouslySkipPermissions).toBe(false)
  })
})



describe('parseSshFlags — bypass flag BEFORE the host (PR #1939 review P1)', () => {
  // An unrecognized flag ahead of the host stops commander collecting operands,
  // so leaving the bypass option unregistered made `ssh --yolo host` find no
  // host at all and skip the whole ssh flow — it fell through to the stub `ssh`
  // usage handler. The pre-refactor path stripped the token before host
  // detection, so this worked; it has to keep working.
  const cases: Array<[string[], string | undefined, boolean, string[]]> = [
    // tokens                                   host      remote bypass  forwarded
    [['--yolo', 'host'], 'host', true, []],
    [['--dangerously-skip-permissions', 'host'], 'host', true, []],
    [['--yolo', 'host', '/tmp'], 'host', true, []],
    [['--yolo', '--local', 'host'], 'host', true, []],
    // …and the value-slot protection is unaffected by that registration
    [['host', '--debug-file', '--yolo'], 'host', false, ['--debug-file', '--yolo']],
    [['host', '--settings', '--yolo', '--yolo'], 'host', true, ['--settings', '--yolo', '--yolo']],
  ]

  for (const [tokens, host, bypass, forwarded] of cases) {
    it(`ssh ${tokens.join(' ')}`, () => {
      const r = parseSshFlags(['ssh', ...tokens])
      expect(r.host).toBe(host as string)
      expect(r.dangerouslySkipPermissions).toBe(bypass)
      expect(r.forwardToMain).toEqual(forwarded)
    })
  }

  it('binds the cwd too when the flag precedes both positionals', () => {
    expect(parseSshFlags(['ssh', '--yolo', 'host', '/tmp']).cwd).toBe('/tmp')
  })

  it('binds the host when a bare -c precedes it', () => {
    // Same class as the bypass case: `-c` is deliberately absent from the LEAN
    // parse (there it would read `--mcp-config -c.json` as a cluster and forge
    // a --continue), so the positional parse has to know it or commander stops
    // collecting operands. origin/main stripped `-c` by index before looking
    // for the host, so this worked before the refactor.
    const c = parseSshFlags(['ssh', '-c', 'host'])
    expect(c.host).toBe('host')
    expect(c.extraCliArgs).toEqual(['--continue'])
    // and the host is NOT left in argv as a stray local prompt
    expect(c.forwardToMain).toEqual([])

    expect(parseSshFlags(['ssh', '-c', 'host', '/tmp']).cwd).toBe('/tmp')
    expect(parseSshFlags(['ssh', '-c', '--local', 'host']).local).toBe(true)

    // combined with the bypass flag, either order
    for (const tokens of [
      ['-c', '--yolo', 'host'],
      ['--yolo', '-c', 'host'],
    ]) {
      const r = parseSshFlags(['ssh', ...tokens])
      expect(r.host).toBe('host')
      expect(r.dangerouslySkipPermissions).toBe(true)
      expect(r.extraCliArgs).toEqual(['--continue'])
      expect(r.forwardToMain).toEqual([])
    }
  })

  it('binds the host when a bare -r precedes it, and claims it for the remote', () => {
    // Same class as `-c`: `--resume` is long-only in the claiming parse (a `-r`
    // there would read `--mcp-config -r.json` as a cluster), so the positional
    // parse has to know the short or commander stops collecting operands.
    // origin/main extracted `-r` by index, so both halves worked before.
    const r = parseSshFlags(['ssh', '-r', 'id', 'host'])
    expect(r.host).toBe('host')
    expect(r.extraCliArgs).toEqual(['--resume', 'id'])
    expect(r.forwardToMain).toEqual([])

    // …and in the position that already bound the host, where the REMOTE was
    // silently losing the resume (it was forwarded to the local command).
    const after = parseSshFlags(['ssh', 'host', '-r', 'id'])
    expect(after.host).toBe('host')
    expect(after.extraCliArgs).toEqual(['--resume', 'id'])
    expect(after.forwardToMain).toEqual([])

    // bare `-r` with no value (the option's value is optional)
    expect(parseSshFlags(['ssh', 'host', '-r']).extraCliArgs).toEqual(['--resume'])
    // alongside -c
    expect(parseSshFlags(['ssh', '-c', '-r', 'id', 'host']).extraCliArgs).toEqual([
      '--continue',
      '--resume',
      'id',
    ])
  })

  it('drops every claimed -r span, not just the first', () => {
    // commander keeps the LAST value, so a single-index removal would forward
    // the other span to the local command and replay the resume there.
    for (const tokens of [
      ['host', '-r', 'a', '-r', 'b'],
      ['-r', 'a', '-r', 'b', 'host'],
      ['host', '-r', 'a', '--resume', 'b'],
      ['host', '--resume', 'b', '-r', 'a'],
    ]) {
      const r = parseSshFlags(['ssh', ...tokens])
      expect(r.host).toBe('host')
      expect(r.extraCliArgs).toEqual(['--resume', 'b'])
      expect(r.forwardToMain).toEqual([])
    }

    // a bare `-r` with no value consumes nothing after it
    expect(parseSshFlags(['ssh', 'host', '-r']).forwardToMain).toEqual([])
    // …and a `-r` sitting in a value slot is still left alone
    expect(
      parseSshFlags(['ssh', 'host', '--mcp-config', '-r']).forwardToMain,
    ).toEqual(['--mcp-config', '-r'])
  })

  it('leaves a short alone when it is the value of a value-DISCARDING option', () => {
    // `--debug-file <path>` has an argParser returning `true`, so the raw text is
    // gone from the resolved options — a check that inspected values could not
    // see that `-c` here is a VALUE, and stripped it out of the forwarded line,
    // leaving --debug-file without its argument.
    const c = parseSshFlags(['ssh', 'host', '--continue', '--debug-file', '-c'])
    expect(c.extraCliArgs).toEqual(['--continue'])
    expect(c.forwardToMain).toEqual(['--debug-file', '-c'])

    const r = parseSshFlags(['ssh', 'host', '--resume', 'x', '--debug-file', '-r'])
    expect(r.extraCliArgs).toEqual(['--resume', 'x'])
    expect(r.forwardToMain).toEqual(['--debug-file', '-r'])

    // a line carrying BOTH a real short and one in a value slot fails safe:
    // the flag goes to the local command rather than risking the value
    const both = parseSshFlags(['ssh', 'host', '-c', '--debug-file', '-c'])
    expect(both.extraCliArgs).toEqual([])
    expect(both.forwardToMain).toEqual(['-c', '--debug-file', '-c'])

    // …and the ordinary cases still claim the short for the remote
    expect(parseSshFlags(['ssh', 'host', '-c']).extraCliArgs).toEqual(['--continue'])
    expect(parseSshFlags(['ssh', 'host', '-r', 'id']).extraCliArgs).toEqual([
      '--resume',
      'id',
    ])
  })

  it('adding -r to the positional parse does not forge a --resume', () => {
    const r = parseSshFlags(['ssh', 'host', '--mcp-config', '-r.json'])
    expect(r.host).toBe('host')
    expect(r.extraCliArgs).toEqual([])
    expect(r.forwardToMain).toEqual(['--mcp-config', '-r.json'])
  })

  it('adding -c to the positional parse does not forge a --continue', () => {
    // The lean parse still owns claiming, so a dash-prefixed VALUE is untouched.
    const r = parseSshFlags(['ssh', 'host', '--mcp-config', '-c.json'])
    expect(r.host).toBe('host')
    expect(r.extraCliArgs).toEqual([])
    expect(r.forwardToMain).toEqual(['--mcp-config', '-c.json'])
  })

  it('still reads the ssh-side flags that follow the bypass token', () => {
    // Commander stops collecting OPERANDS at a token it doesn't recognize, but
    // keeps parsing OPTIONS — so the ssh-side fields are intact even though the
    // positionals had to come from the bypass-registered parse.
    expect(parseSshFlags(['ssh', '--yolo', '--local', 'host']).local).toBe(true)
    expect(
      parseSshFlags(['ssh', '--yolo', '--permission-mode', 'plan', 'host'])
        .permissionMode,
    ).toBe('plan')
    expect(
      parseSshFlags(['ssh', '--yolo', '--model', 'sonnet', 'host']).extraCliArgs,
    ).toEqual(['--model', 'sonnet'])
    expect(
      parseSshFlags(['ssh', '--yolo', '--continue', 'host']).extraCliArgs,
    ).toEqual(['--continue'])
    expect(
      parseSshFlags(['ssh', '--yolo', '--fallback-model', 'm', 'host'])
        .extraCliArgs,
    ).toEqual(['--fallback-model', 'm'])

    // …and all of it together, with a cwd
    const all = parseSshFlags([
      'ssh',
      '--dangerously-skip-permissions',
      '--local',
      '--model',
      'm',
      'host',
      '/tmp',
    ])
    expect(all.host).toBe('host')
    expect(all.cwd).toBe('/tmp')
    expect(all.local).toBe(true)
    expect(all.dangerouslySkipPermissions).toBe(true)
    expect(all.extraCliArgs).toEqual(['--model', 'm'])
  })
})

describe('parseSshFlags — a bypass token in a MAIN option VALUE slot', () => {
  // Regression for PR #1939 review P1: the ssh-only parse used to register the
  // bypass option itself. Not knowing main's arities, it claimed the token in
  // `ssh host --debug-file --yolo` as a bypass request AND swallowed it, so the
  // REMOTE session started with permission bypass while the main command lost
  // the value it needed. Whether the flag is set is now asked of the full main
  // option set, and the token is forwarded verbatim.
  const cases: Array<[string[], boolean]> = [
    [['--debug-file', '--yolo'], false],
    [['--settings', '--yolo'], false],
    [['--mcp-config', '--yolo'], false],
    [['--system-prompt', '--dangerously-skip-permissions'], false],
    // …while a genuine flag still enables it, including after a value slot has
    // eaten an earlier occurrence (the case that made occurrence-counting
    // unworkable in the deleted claimBypassFlag).
    [['--yolo'], true],
    [['--settings', '--yolo', '--yolo'], true],
    [['--yolo', '--settings', 'x'], true],
  ]

  for (const [userTokens, expectedRemoteBypass] of cases) {
    it(`${userTokens.join(' ')} -> remote bypass ${expectedRemoteBypass}`, () => {
      const r = parseSshFlags(['ssh', 'host', ...userTokens])
      expect(r.host).toBe('host')
      expect(r.dangerouslySkipPermissions).toBe(expectedRemoteBypass)
      // nothing is consumed or reordered: main sees exactly what was typed
      expect(r.forwardToMain).toEqual(userTokens)
      expect(mainReads(r.forwardToMain)).toEqual(mainReads(userTokens))
    })
  }
})

describe('parseSshFlags — post-`--` print token survives the argv rewrite', () => {
  it('detects headless via commander, including a bundled -p', () => {
    expect(parseSshFlags(['ssh', 'host', '-pv']).headless).toBe(true)
    expect(parseSshFlags(['ssh', 'host', '-p']).headless).toBe(true)
    expect(parseSshFlags(['ssh', 'host', '--print']).headless).toBe(true)
    // positional after `--` is data, not headless mode
    expect(parseSshFlags(['ssh', 'host', '/tmp', '--', '--print']).headless).toBe(false)
    expect(parseSshFlags(['ssh', 'host']).headless).toBe(false)
  })

  // Regression for PR #1939 review P1: `ssh host -- --print` is NOT headless,
  // but main.tsx rewrites argv to `-- --print`, and the print-mode gates there
  // used a raw token scan that saw `--print` and took the local print path
  // instead of opening the interactive remote session.
  it('is invisible to a commander-authoritative print check', () => {
    const r = parseSshFlags(['ssh', 'host', '--', '--print'])
    expect(r.host).toBe('host')
    expect(r.headless).toBe(false)
    expect(r.forwardToMain).toEqual(['--', '--print'])

    // The rewritten argv is what main.tsx's print gates see. A token scan gets
    // this wrong; resolvesPrintMode (what those gates now use) does not.
    expect(r.forwardToMain.includes('--print')).toBe(true) // the trap
    expect(resolvesPrintMode(r.forwardToMain)).toBe(false) // the fix

    // and a real print request is still detected after the rewrite
    const headless = parseSshFlags(['ssh', 'host', '-p'])
    expect(headless.headless).toBe(true)
  })
})

describe('parseSshFlags — ssh controls in a MAIN option VALUE slot', () => {
  // The ssh-only parse does not know main arities, so it would claim a control
  // that commander gives to a preceding required-value option: `ssh host
  // --settings --local` would start a LOCAL test session AND drop the user's
  // --settings value. The arity-aware parse is authoritative; when the two
  // disagree the line is abandoned so the real `ssh` command reports usage.
  for (const [control, tokens] of [
    ['--local', ['--settings', '--local']],
    ['--model', ['--settings', '--model', 'x']],
    ['--resume', ['--settings', '--resume']],
    ['--continue', ['--settings', '--continue']],
    ['--local after another value flag', ['--system-prompt', '--local']],
    ['--local after a valueless-parser flag', ['--debug-file', '--local']],
  ] as Array<[string, string[]]>) {
    it(`does not claim ${control} from a value slot`, () => {
      const r = parseSshFlags(['ssh', 'host', ...tokens])
      expect(r.host).toBeUndefined()
      expect(r.local).toBe(false)
      expect(r.extraCliArgs).toEqual([])
    })
  }

  it('still honours the same controls when they are genuinely present', () => {
    expect(parseSshFlags(['ssh', 'host', '--local']).local).toBe(true)
    expect(parseSshFlags(['ssh', 'host', '--model', 'x']).extraCliArgs).toEqual([
      '--model',
      'x',
    ])
    expect(parseSshFlags(['ssh', 'host', '--continue']).extraCliArgs).toEqual([
      '--continue',
    ])
    expect(parseSshFlags(['ssh', 'host', '--resume', 'id']).extraCliArgs).toEqual([
      '--resume',
      'id',
    ])
    expect(
      parseSshFlags(['ssh', 'host', '--permission-mode', 'plan']).permissionMode,
    ).toBe('plan')

    // …including after a value flag that IS satisfied, which is the case the
    // check must not confuse with a value slot
    const satisfied = parseSshFlags(['ssh', 'host', '--settings', 'f.json', '--local'])
    expect(satisfied.host).toBe('host')
    expect(satisfied.local).toBe(true)
  })
})

describe('parseSshFlags — help detection when a required value is missing', () => {
  it('sees --help/-h in commander `unknown` (assumption of the short-circuit)', () => {
    // The help short-circuit reads mainUnknown. That only works because
    // commander 12.1.0's parseOptions() reports help flags as unknown rather
    // than handling them itself — parse() is what acts on help, not
    // parseOptions(). Pinned here so a commander upgrade that moves help
    // handling into parseOptions fails loudly instead of silently routing an
    // `ssh host --help` into a real ssh session.
    const cmd = applyMainOptions(new Command())
      .allowUnknownOption()
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })
    const { unknown } = cmd.parseOptions(['host', '--help'])
    expect(unknown).toEqual(['--help'])

    const short = applyMainOptions(new Command())
      .allowUnknownOption()
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} })
    expect(short.parseOptions(['host', '-h']).unknown).toEqual(['-h'])

    // …and the behaviour that rests on it, both directions
    expect(parseSshFlags(['ssh', 'host', '--help']).host).toBeUndefined()
    expect(parseSshFlags(['ssh', 'host', '-h']).host).toBeUndefined()
    // a --help in a VALUE slot is not a help request
    expect(parseSshFlags(['ssh', 'host', '--debug-file', '--help']).host).toBe('host')
  })

  // The short-circuit reads commander's `unknown` list. A required value missing
  // at the END of the line throws before commander returns that list, which left
  // it empty and made `ssh host --help --settings` route instead of falling
  // through to the real `ssh` help.
  it('still short-circuits on --help/-h before a valueless option', () => {
    for (const tokens of [
      ['--help', '--settings'],
      ['-h', '--settings'],
      ['--help', '--system-prompt'],
      ['--settings', 'x', '--help'],
    ]) {
      const r = parseSshFlags(['ssh', 'host', ...tokens])
      expect(r.host).toBeUndefined()
      expect(r.forwardToMain).toEqual([])
    }
  })

  it('short-circuits even when the missing value belongs to a VALIDATING option', () => {
    // The retry appends a filler token to satisfy arity, but an option with
    // .choices() or a throwing argParser rejects it, so commander again reports
    // no `unknown` and the help token was invisible — the route proceeded to a
    // real connect. These are the shapes the earlier --settings/--system-prompt
    // coverage missed, because those accept any string.
    for (const tokens of [
      ['--help', '--output-format'], // .choices()
      ['--help', '--effort'], // throwing argParser
      ['-h', '--thinking'], // .choices(), short form
      ['--help', '--max-turns'], // numeric argParser
      ['--help', '--max-budget-usd'], // numeric argParser
      ['-h', '--teammate-mode'], // .choices()
      ['--help', '--permission-mode'], // .choices(), also ssh-side
    ]) {
      const r = parseSshFlags(['ssh', 'host', ...tokens])
      expect(r.host).toBeUndefined()
      expect(r.forwardToMain).toEqual([])
    }
  })

  it('does not turn a --help VALUE into a help request', () => {
    // `--settings --help` gives --help to --settings, so this is a real route.
    const r = parseSshFlags(['ssh', 'host', '--settings', '--help'])
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual(['--settings', '--help'])
  })

  it('never leaks the retry filler token into the result', () => {
    // The filler only ever reaches the throwaway retry parse; forwarding comes
    // from the ssh-side parses, so it cannot appear downstream.
    const r = parseSshFlags(['ssh', 'host', '--settings'])
    expect(JSON.stringify(r)).not.toContain('filler')
  })
})

describe('parseSshFlags — main-option VALUES are never read as ssh controls', () => {
  it('does not treat a --help in a value slot as a help request', () => {
    // `--debug-file --help`: --help is the path value, so the ssh flow routes.
    const r = parseSshFlags(['ssh', 'host', '--debug-file', '--help'])
    expect(r.host).toBe('host')
    expect(r.forwardToMain).toEqual(['--debug-file', '--help'])
    // A genuine help request still short-circuits…
    expect(parseSshFlags(['ssh', 'host', '--help']).host).toBeUndefined()
    // …and a post-`--` one is data, so the ssh flow routes.
    expect(parseSshFlags(['ssh', 'host', '--', '--help']).host).toBe('host')
  })

  it('does not claim a -c that is another option value as --continue', () => {
    const r = parseSshFlags(['ssh', 'host', '--mcp-config', '-c'])
    expect(r.extraCliArgs).toEqual([])
    expect(r.forwardToMain).toEqual(['--mcp-config', '-c'])
    // The genuine short flag is still claimed for the remote.
    expect(parseSshFlags(['ssh', 'host', '-c']).extraCliArgs).toEqual(['--continue'])

    // …even when a long --continue elsewhere on the line also sets the option,
    // the `-c` that is another option's value must survive.
    const both = parseSshFlags(['ssh', 'host', '--continue', '--mcp-config', '-c'])
    expect(both.extraCliArgs).toEqual(['--continue'])
    expect(both.forwardToMain).toEqual(['--mcp-config', '-c'])
  })
})

describe('parseSshFlags — host validity and headless after a rejected value', () => {
  it('does not treat an empty operand as a host', () => {
    // `ssh "$HOST" --yolo` with HOST unset passed main.tsx's `host !== undefined`
    // route check while failing the Boolean(host) gate that arms the
    // remote-bypass guards — leaving a LOCAL session running every tool
    // bypassing, with no remote at all. origin/main printed the usage error.
    const empty = parseSshFlags(['ssh', '', '--yolo'])
    expect(empty.host).toBeUndefined()
    expect(parseSshFlags(['ssh', '']).host).toBeUndefined()
    expect(parseSshFlags(['ssh', '', '/tmp']).host).toBeUndefined()
    // a real host is unaffected
    expect(parseSshFlags(['ssh', 'host', '--yolo']).host).toBe('host')
  })

  it('still resolves headless when an earlier option rejects its value', () => {
    // headless came from a mainOpts snapshot taken after commander aborted at
    // the rejected value, so the guard in main.tsx was silently skipped and the
    // ssh line fell through to the LOCAL print path.
    expect(parseSshFlags(['ssh', 'host', '--output-format', 'bogus', '-p']).headless).toBe(true)
    expect(parseSshFlags(['ssh', 'host', '--thinking', 'bogus', '-p']).headless).toBe(true)
    expect(parseSshFlags(['ssh', 'host', '-p']).headless).toBe(true)
    // post-`--` print is still positional data, not a print request
    expect(parseSshFlags(['ssh', 'host', '--', '--print']).headless).toBe(false)
  })
})

describe('parseSshFlags — short clusters BEFORE the host', () => {
  it('credits the parse that claimed the cluster', () => {
    // The lean parse does not register the shorts and the exact-token checks
    // never match a cluster, so a cluster claimed by the positional parse used
    // to reach NEITHER destination: absent from extraCliArgs, and absent from
    // positionalUnknown which the swap adopts. It simply disappeared.
    const rid = parseSshFlags(['ssh', '-rid', 'host'])
    expect(rid.host).toBe('host')
    expect(rid.extraCliArgs).toEqual(['--resume', 'id'])
    expect(rid.forwardToMain).toEqual([])

    // `-cr host /tmp`: commander gives `host` to -r's OPTIONAL value, so /tmp is
    // the first free operand. Surprising, but identical to what the main grammar
    // does with the same tokens — and the flags now reach the remote either way.
    const cr = parseSshFlags(['ssh', '-cr', 'host', '/tmp'])
    expect(cr.host).toBe('/tmp')
    expect(cr.extraCliArgs).toEqual(['--continue', '--resume', 'host'])
    expect(cr.forwardToMain).toEqual([])

    // `-cr host` binds no host at all for the same reason (`host` is -r's
    // value), so the route is abandoned and the real ssh command reports usage.
    expect(parseSshFlags(['ssh', '-cr', 'host']).host).toBeUndefined()

    // the non-clustered forms are unchanged
    expect(parseSshFlags(['ssh', '-c', 'host']).extraCliArgs).toEqual(['--continue'])
    expect(parseSshFlags(['ssh', '-r', 'id', 'host']).extraCliArgs).toEqual([
      '--resume',
      'id',
    ])
    // …and a short in a value slot is still left alone
    expect(
      parseSshFlags(['ssh', 'host', '--debug-file', '-c']).forwardToMain,
    ).toEqual(['--debug-file', '-c'])
  })
})

describe('parseSshFlags — a claimed --permission-mode never reaches the local command', () => {
  it('keeps the mode out of forwardToMain entirely', () => {
    // Unlike the bypass FLAG (forwarded on purpose and neutralized later at the
    // permission-mode computation), the mode is claimed for the remote and must
    // not be forwarded at all: `--permission-mode bypassPermissions` reaching
    // the local command would put THIS session into a dangerous mode, which no
    // later backstop would undo because it arrives as a legitimate CLI request.
    for (const mode of [
      'bypassPermissions',
      'fullAccess',
      'plan',
      'acceptEdits',
    ] as const) {
      const r = parseSshFlags(['ssh', 'host', '--permission-mode', mode])
      expect(r.permissionMode).toBe(mode)
      expect(r.forwardToMain).toEqual([])
      expect(r.forwardToMain.join(' ')).not.toContain('--permission-mode')
    }

    // …including before the host, where the positional parse is the claimant
    const before = parseSshFlags(['ssh', '--permission-mode', 'plan', 'host'])
    expect(before.host).toBe('host')
    expect(before.permissionMode).toBe('plan')
    expect(before.forwardToMain).toEqual([])
  })
})

describe('parseSshFlags — bypass token in a value-DISCARDING option slot', () => {
  it('does not claim it, and keeps the option its argument', () => {
    // `--debug-file <path>` has an argParser returning `true`, so the raw text
    // is gone from the resolved options. The value-shaped guard could not see
    // that the second `--yolo` here is --debug-file's VALUE: the operand swap
    // applied, the positional parse claimed it as a bypass request, and the
    // forwarded line came out as ['--debug-file'] — argument missing.
    for (const spelling of ['--yolo', '--dangerously-skip-permissions']) {
      const tokens = [spelling, 'host', '--debug-file', spelling]
      const r = parseSshFlags(['ssh', ...tokens])
      // ambiguous from the ssh side, so the route is abandoned and the real
      // `ssh` command reports usage — never a silently truncated argv
      expect(r.host).toBeUndefined()
      expect(r.forwardToMain).toEqual(tokens)
    }

    // the unambiguous shapes are unchanged
    expect(parseSshFlags(['ssh', '--yolo', 'host']).host).toBe('host')
    expect(parseSshFlags(['ssh', '--yolo', 'host']).dangerouslySkipPermissions).toBe(true)
    expect(parseSshFlags(['ssh', '--yolo', 'host', '/tmp']).cwd).toBe('/tmp')
    // and a bypass token that is purely a value still grants nothing
    const valueOnly = parseSshFlags(['ssh', 'host', '--debug-file', '--yolo'])
    expect(valueOnly.dangerouslySkipPermissions).toBe(false)
    expect(valueOnly.forwardToMain).toEqual(['--debug-file', '--yolo'])
  })
})
