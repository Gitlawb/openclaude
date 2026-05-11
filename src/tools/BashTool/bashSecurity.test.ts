import { describe, expect, test } from 'bun:test'

import { stripSafeHeredocSubstitutions } from './bashSecurity.js'

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
