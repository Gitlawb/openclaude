import { describe, expect, it } from 'bun:test'
import { parseSshFlags } from './sshPreParse.js'

describe('parseSshFlags', () => {
  it('extracts host-adjacent flags without enabling bypass', () => {
    const r = parseSshFlags(['ssh', 'host', '--permission-mode', 'auto'])
    expect(r.permissionMode).toBe('auto')
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('enables bypass for a genuine standalone --yolo / canonical flag', () => {
    expect(parseSshFlags(['ssh', 'host', '--yolo']).dangerouslySkipPermissions).toBe(true)
    expect(
      parseSshFlags(['ssh', 'host', '--dangerously-skip-permissions'])
        .dangerouslySkipPermissions,
    ).toBe(true)
    // both spellings + a repeat are all stripped, none survives into remaining
    const r = parseSshFlags(['ssh', 'host', '--yolo', '--dangerously-skip-permissions', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(true)
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('does NOT enable bypass when --yolo is the value of --permission-mode (escalation guard)', () => {
    // Commander would parse --yolo as the (invalid) mode value and reject it;
    // the pre-parser must not treat it as a bypass flag.
    const r = parseSshFlags(['ssh', 'host', '--permission-mode', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.permissionMode).toBe('--yolo')
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('does NOT enable bypass when --yolo is the value of --model (escalation guard)', () => {
    const r = parseSshFlags(['ssh', 'host', '--model', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.extraCliArgs).toEqual(['--model', '--yolo'])
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('still enables bypass alongside a legitimately-valued flag', () => {
    // --permission-mode consumes `auto`; the separate --yolo is a real bypass.
    const r = parseSshFlags(['ssh', '--permission-mode', 'auto', 'host', '--yolo'])
    expect(r.permissionMode).toBe('auto')
    expect(r.dangerouslySkipPermissions).toBe(true)
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('treats flags after -- as positional: no bypass, no --local', () => {
    // `ssh host -- --yolo` / `ssh host -- --local` — everything after -- is
    // positional and must not be parsed as options.
    const y = parseSshFlags(['ssh', 'host', '--', '--yolo'])
    expect(y.dangerouslySkipPermissions).toBe(false)
    expect(y.remaining).toEqual(['ssh', 'host', '--', '--yolo'])

    const l = parseSshFlags(['ssh', 'host', '--', '--local', '--permission-mode', 'x'])
    expect(l.local).toBe(false)
    expect(l.permissionMode).toBeUndefined()
    expect(l.dangerouslySkipPermissions).toBe(false)
    expect(l.remaining).toEqual(['ssh', 'host', '--', '--local', '--permission-mode', 'x'])
  })

  it('still parses flags before -- while leaving the rest positional', () => {
    const r = parseSshFlags(['ssh', '--yolo', 'host', '--', '--model', 'x'])
    expect(r.dangerouslySkipPermissions).toBe(true)
    expect(r.remaining).toEqual(['ssh', 'host', '--', '--model', 'x'])
  })

  it('consumes every occurrence of value-taking flags left-to-right, including flag-like values', () => {
    const r = parseSshFlags(['ssh', 'host', '--model', 'ok', '--model', '--yolo', 'value'])
    expect(r.extraCliArgs).toEqual(['--model', 'ok', '--model', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.remaining).toEqual(['ssh', 'host', 'value'])
  })

  it('does not let --local interfere with --permission-mode value consumption', () => {
    const r = parseSshFlags(['ssh', 'host', '--permission-mode', '--local'])
    expect(r.permissionMode).toBe('--local')
    expect(r.local).toBe(false)
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('consumes equals forms of value-taking flags and preserves embedded =', () => {
    const r = parseSshFlags([
      'ssh',
      'host',
      '--permission-mode=fullAccess',
      '--model=provider=model',
      '--resume=abc=def',
    ])
    expect(r.permissionMode).toBe('fullAccess')
    expect(r.extraCliArgs).toEqual(['--model', 'provider=model', '--resume', 'abc=def'])
    expect(r.remaining).toEqual(['ssh', 'host'])
  })

  it('preserves value-taking flags that lack a value so commander can error', () => {
    const last = parseSshFlags(['ssh', 'host', '--model'])
    expect(last.extraCliArgs).toEqual([])
    expect(last.remaining).toEqual(['ssh', 'host', '--model'])

    const beforeEoo = parseSshFlags(['ssh', 'host', '--permission-mode', '--', 'x'])
    expect(beforeEoo.permissionMode).toBeUndefined()
    expect(beforeEoo.remaining).toEqual(['ssh', 'host', '--permission-mode', '--', 'x'])
  })
})
