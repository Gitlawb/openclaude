import { describe, expect, it } from 'bun:test'
import { parseSshFlags } from './sshPreParse.js'

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

  it('correctly identifies the host after a single-value MAIN flag (arity fix)', () => {
    // jatmn P1: previously `--settings`s value shifted the host positional. Now
    // the parser knows --settings takes one value, so the host is `target-host`
    // and --settings is forwarded to the local main command.
    const r = parseSshFlags(['ssh', '--settings', 'foo.json', 'target-host'])
    expect(r.host).toBe('target-host')
    expect(r.forwardToMain).toEqual(['--settings', 'foo.json'])
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
    expect(parseSshFlags(['ssh', 'host', '--yolo']).dangerouslySkipPermissions).toBe(true)
    expect(
      parseSshFlags(['ssh', 'host', '--dangerously-skip-permissions'])
        .dangerouslySkipPermissions,
    ).toBe(true)
  })

  it('does NOT enable bypass when --yolo is consumed as --permission-mode value', () => {
    // commander consumes --yolo as the mode value (an invalid choice → no route),
    // never as a bypass flag.
    const r = parseSshFlags(['ssh', 'host', '--permission-mode', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
  })

  it('does NOT enable bypass for a --yolo positional after --', () => {
    const r = parseSshFlags(['ssh', 'host', '/tmp', '--', '--yolo'])
    expect(r.dangerouslySkipPermissions).toBe(false)
    expect(r.host).toBe('host')
    expect(r.cwd).toBe('/tmp')
    expect(r.forwardToMain).toEqual(['--', '--yolo'])
  })

  it('uses last-value semantics for a repeated option', () => {
    const r = parseSshFlags(['ssh', 'host', '--settings', 'a', '--settings', 'b'])
    expect(r.forwardToMain).toEqual(['--settings', 'b'])
  })

  it('forwards ssh model/resume/continue to the remote, not the local main', () => {
    const r = parseSshFlags(['ssh', 'host', '--model', 'gpt', '--continue'])
    expect(r.host).toBe('host')
    expect(r.extraCliArgs).toEqual(['--continue', '--model', 'gpt'])
    expect(r.forwardToMain).toEqual([])
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
