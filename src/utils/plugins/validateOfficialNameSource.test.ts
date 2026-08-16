import { describe, expect, test } from 'bun:test'
import {
  OFFICIAL_GITHUB_ORG,
  validateOfficialNameSource,
} from './schemas.js'

const RESERVED = 'claude-code-marketplace'

// Regression: the git-URL branch validated official ownership with a substring
// check (`url.includes('github.com/anthropics/')`), which also matches hostile
// URLs whose host is not github.com or where that text appears in the path. An
// attacker could then register a repo they control under a reserved official
// marketplace name. Ownership must be decided by the exact host + first path
// segment. Same class as the xai/bridge substring-host fixes.
describe('validateOfficialNameSource — git URL host is matched exactly', () => {
  function gitUrl(url: string) {
    return validateOfficialNameSource(RESERVED, { source: 'git', url })
  }

  // Genuine official URLs are accepted (null = no error).
  test('accepts official github.com/anthropics URLs (https, .git, ssh, scp)', () => {
    expect(gitUrl('https://github.com/anthropics/marketplace')).toBeNull()
    expect(gitUrl('https://github.com/anthropics/marketplace.git')).toBeNull()
    expect(gitUrl('https://user@github.com/anthropics/marketplace')).toBeNull()
    expect(gitUrl('ssh://git@github.com/anthropics/marketplace.git')).toBeNull()
    expect(gitUrl('git@github.com:anthropics/marketplace.git')).toBeNull()
    // Host + org are case-insensitive.
    expect(gitUrl('https://GitHub.com/Anthropics/marketplace')).toBeNull()
  })

  // Hostile URLs that the old substring check let through must now be rejected.
  const bypasses = [
    'https://notgithub.com/anthropics/evil',
    'https://evil.com/github.com/anthropics/evil',
    'https://github.com.attacker.com/anthropics/evil',
    'https://evilgithub.com/anthropics/evil',
    'git@notgithub.com:anthropics/evil.git',
    'git@evil.com/github.com:anthropics/evil.git',
  ]
  for (const url of bypasses) {
    test(`rejects reserved-name impersonation via ${url}`, () => {
      const result = gitUrl(url)
      expect(result).not.toBeNull()
      expect(result).toContain('reserved')
    })
  }

  // A different org on the real host is still rejected.
  test('rejects a non-official org on github.com', () => {
    expect(gitUrl('https://github.com/anthropics-evil/x')).not.toBeNull()
    expect(gitUrl('https://github.com/notanthropics/x')).not.toBeNull()
    expect(gitUrl('git@github.com:someoneelse/x.git')).not.toBeNull()
  })

  // Non-reserved names skip validation entirely (any source is fine).
  test('non-reserved names are not validated', () => {
    expect(
      validateOfficialNameSource('my-personal-marketplace', {
        source: 'git',
        url: 'https://notgithub.com/anthropics/evil',
      }),
    ).toBeNull()
  })

  test('OFFICIAL_GITHUB_ORG is anthropics', () => {
    expect(OFFICIAL_GITHUB_ORG).toBe('anthropics')
  })
})
