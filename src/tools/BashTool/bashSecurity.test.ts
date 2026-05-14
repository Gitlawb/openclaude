import { describe, expect, test } from 'bun:test'

import {
  bashCommandIsSafe_DEPRECATED,
  stripSafeHeredocSubstitutions,
} from './bashSecurity.js'

describe('stripSafeHeredocSubstitutions', () => {
  test('strips a single safe heredoc substitution', () => {
    const cmd = "git commit -m $(cat <<'EOF'\nfix: whatever\nEOF\n)"
    const result = stripSafeHeredocSubstitutions(cmd)
    expect(result).toBe('git commit -m ')
  })

  test('returns null for nested heredoc substitutions (stale-index regression)', () => {
    const cmd = "$(cat <<'OUTER'\n$(cat <<'INNER'\ndata\nINNER)\nOUTER)"
    const result = stripSafeHeredocSubstitutions(cmd)
    expect(result).toBeNull()
  })

  test('returns null when no heredoc substitution is present', () => {
    const result = stripSafeHeredocSubstitutions('echo hello world')
    expect(result).toBeNull()
  })

  test('strips multiple non-nested heredoc substitutions', () => {
    const cmd = "$(cat <<'A'\nfoo\nA) $(cat <<'B'\nbar\nB)"
    const result = stripSafeHeredocSubstitutions(cmd)
    expect(result).toBe(' ')
  })
})

describe('validateZshDangerousCommands: fc -e detection (#1051 BUG-01)', () => {
  // Regression: the previous regex `/\s-\S*e/` matched any flag whose body
  // contained an `e` anywhere, so legitimate fc invocations with unrelated
  // long-style flags like `-reset`, `-reverse`, or `-message` (real or not,
  // users do type them) tripped the dangerous-zsh check and surfaced an
  // interactive permission prompt to the user. The replacement caps the
  // short-flag bundle at 4 chars total and requires `e` to be the last
  // letter before whitespace or end-of-string.
  test('asks for `fc -e vim ls` (real `-e` editor flag)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -e vim ls')
    expect(result.behavior).toBe('ask')
  })

  test('asks for bundled short flags ending in e (`fc -le ls`)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -le ls')
    expect(result.behavior).toBe('ask')
  })

  test('asks for 3-char bundled short flags ending in e (`fc -lne ls`)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -lne ls')
    expect(result.behavior).toBe('ask')
  })

  test('does not ask for `fc -reset` (false positive on `-reset`)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -reset')
    expect(result.behavior).not.toBe('ask')
  })

  test('does not ask for `fc -reverse` (false positive on `-reverse`)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -reverse')
    expect(result.behavior).not.toBe('ask')
  })

  test('does not ask for `fc -message` (false positive on `-message`)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -message')
    expect(result.behavior).not.toBe('ask')
  })

  test('does not ask for `fc -l` (safe list flag)', () => {
    const result = bashCommandIsSafe_DEPRECATED('fc -l')
    expect(result.behavior).not.toBe('ask')
  })
})
