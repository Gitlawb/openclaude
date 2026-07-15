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

  it('parses --local and forwards resume/model flags', () => {
    const r = parseSshFlags(['ssh', '--local', 'host', '--model', 'gpt', '--continue'])
    expect(r.local).toBe(true)
    expect(r.extraCliArgs).toEqual(['--continue', '--model', 'gpt'])
    expect(r.remaining).toEqual(['ssh', 'host'])
  })
})
