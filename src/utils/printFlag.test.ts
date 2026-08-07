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
})
