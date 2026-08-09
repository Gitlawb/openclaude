import { describe, expect, test } from 'bun:test'
import { hasPrintFlag } from './printFlag.js'

describe('hasPrintFlag', () => {
  test('detects the standalone -p and --print flags', () => {
    expect(hasPrintFlag(['-p'])).toBe(true)
    expect(hasPrintFlag(['--print'])).toBe(true)
    expect(hasPrintFlag(['--print', 'prompt'])).toBe(true)
  })

  test('detects the --print=prompt long form', () => {
    expect(hasPrintFlag(['cc://host', '--print=prompt'])).toBe(true)
  })

  test('detects an attached short-option value (-pprompt)', () => {
    expect(hasPrintFlag(['cc://host', '-pprompt'])).toBe(true)
  })

  test('does not mistake bare positional text for the flag', () => {
    expect(hasPrintFlag(['cc://host', 'prompt'])).toBe(false)
    expect(hasPrintFlag(['cc://host', '-x', 'prompt'])).toBe(false)
  })

  test('stops at the -- end-of-options marker', () => {
    // A `--print` token after `--` is positional, not the print flag.
    expect(hasPrintFlag(['cc://host', '--', '--print'])).toBe(false)
    expect(hasPrintFlag(['cc://host', '--', '-p'])).toBe(false)
  })

  test('does not classify a value of a required option as the print flag', () => {
    expect(hasPrintFlag(['--system-prompt', '--print=custom'])).toBe(false)
    expect(hasPrintFlag(['--model', '-p'])).toBe(false)
    expect(hasPrintFlag(['--permission-mode', '--print'])).toBe(false)
    expect(hasPrintFlag(['--system-prompt=--print=custom'])).toBe(false)
  })

  test('does not classify a value of an optional option as the print flag unless explicitly provided', () => {
    // Optional-value options (--debug, --resume, --from-pr) do not consume a
    // following flag, so --print/-p is still detected.
    expect(hasPrintFlag(['--resume', '--print'])).toBe(true)
    expect(hasPrintFlag(['--debug', '-p'])).toBe(true)

    // But a non-flag value is consumed and not mistaken for the print flag.
    expect(hasPrintFlag(['--resume', 'print'])).toBe(false)
    expect(hasPrintFlag(['--debug', 'p'])).toBe(false)
  })
})
