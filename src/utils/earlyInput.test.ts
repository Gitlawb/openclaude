import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  isCapturingEarlyInput,
  startCapturingEarlyInput,
  stopCapturingEarlyInput,
} from './earlyInput.js'

// startCapturingEarlyInput reads process.argv and drives the REAL process.stdin
// (setRawMode, ref, 'readable' listener). Under `bun test` stdin is usually not
// a TTY, so the gate would never be reached; these stub the TTY surface and
// restore every mutated descriptor afterwards so no raw-mode or listener state
// leaks into other files.
const STDIN_KEYS = ['isTTY', 'setEncoding', 'setRawMode', 'ref'] as const

describe('startCapturingEarlyInput print-mode gate', () => {
  let saved: Map<string, PropertyDescriptor | undefined>
  let originalArgv: string[]
  let rawModeCalls: boolean[]

  beforeEach(() => {
    originalArgv = process.argv
    rawModeCalls = []
    saved = new Map(
      STDIN_KEYS.map(key => [
        key,
        Object.getOwnPropertyDescriptor(process.stdin, key),
      ]),
    )
    const stub = {
      isTTY: true,
      setEncoding: () => process.stdin,
      setRawMode: (mode: boolean) => {
        rawModeCalls.push(mode)
        return process.stdin
      },
      ref: () => process.stdin,
    }
    for (const key of STDIN_KEYS) {
      Object.defineProperty(process.stdin, key, {
        value: stub[key],
        configurable: true,
        writable: true,
      })
    }
  })

  afterEach(() => {
    // Ordering matters: stop first (it removes the 'readable' listener via the
    // stubbed stdin) and only then restore the descriptors.
    stopCapturingEarlyInput()
    for (const key of STDIN_KEYS) {
      const descriptor = saved.get(key)
      if (descriptor) {
        Object.defineProperty(process.stdin, key, descriptor)
      } else {
        delete (process.stdin as unknown as Record<string, unknown>)[key]
      }
    }
    process.argv = originalArgv
  })

  const startWith = (args: string[]): boolean => {
    process.argv = ['node', 'openclaude', ...args]
    startCapturingEarlyInput()
    return isCapturingEarlyInput()
  }

  it('captures when no print flag is present', () => {
    expect(startWith([])).toBe(true)
    expect(rawModeCalls).toEqual([true])
  })

  it.each([[['--print']], [['-p']], [['-p', 'hi']], [['--print', 'hi']]])(
    'blocks capture for %j (print mode)',
    args => {
      // Raw mode disables ISIG, so terminal Ctrl+C no longer raises SIGINT.
      // Capturing under -p would make a headless run uninterruptible.
      expect(startWith(args)).toBe(false)
      expect(rawModeCalls).toEqual([])
    },
  )

  it.each([[['--', '--print']], [['--', '-p']]])(
    'still captures for %j — a post-`--` token is a positional, not print mode',
    args => {
      // This is the case the gate exists for: the ssh argv rewrite can emit a
      // `--print` AFTER `--`, where commander treats it as a plain operand. A
      // naive `argv.includes('--print')` scan would read that as print mode and
      // silently drop the user's early keystrokes in an interactive session.
      expect(startWith(args)).toBe(true)
      expect(rawModeCalls).toEqual([true])
    },
  )

  it('is idempotent — a second call does not re-enter raw mode', () => {
    expect(startWith([])).toBe(true)
    startCapturingEarlyInput()
    expect(isCapturingEarlyInput()).toBe(true)
    expect(rawModeCalls).toEqual([true])
  })

  it('does not capture when stdin is not a TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
      writable: true,
    })
    expect(startWith([])).toBe(false)
    expect(rawModeCalls).toEqual([])
  })
})
