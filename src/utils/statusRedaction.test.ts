import { homedir } from 'os'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import { redactPathForStatus, redactUrlForStatus } from './statusRedaction.ts'

const REAL_HOMEDIR = homedir()
const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_USERPROFILE = process.env.USERPROFILE

function restoreEnvValue(key: 'HOME' | 'USERPROFILE', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('redactUrlForStatus', () => {
  test('redacts username and password in proxy URLs', () => {
    const redacted = redactUrlForStatus(
      'https://alice:secret@proxy.example.com:8080',
    )

    expect(redacted).not.toContain('alice')
    expect(redacted).not.toContain('secret')
    expect(redacted).toBe(
      'https://redacted:redacted@proxy.example.com:8080/',
    )
  })

  test('redacts token-like query parameters', () => {
    const redacted = redactUrlForStatus(
      'https://proxy.example.com:8080?token=abc123',
    )

    expect(redacted).not.toContain('abc123')
    expect(redacted).toBe('https://proxy.example.com:8080/?token=redacted')
  })

  test('redacts password-only credentials', () => {
    const redacted = redactUrlForStatus(
      'https://:s3cret@proxy.example.com:8080',
    )

    expect(redacted).not.toContain('s3cret')
    expect(redacted).toBe('https://:redacted@proxy.example.com:8080/')
  })

  test('removes fragments (may carry tokens)', () => {
    const redacted = redactUrlForStatus(
      'https://proxy.example.com:8080/path#top',
    )

    expect(redacted).toBe('https://proxy.example.com:8080/path')
    expect(redacted).not.toContain('#')
  })

  test('removes fragment that carries a token-like value', () => {
    const redacted = redactUrlForStatus(
      'https://proxy.example.com:8080#access_token=leaked',
    )

    expect(redacted).not.toContain('leaked')
    expect(redacted).not.toContain('#')
  })

  test('keeps local proxy URLs useful', () => {
    const redacted = redactUrlForStatus('http://localhost:8888')
    expect(redacted).toMatch(/^http:\/\/localhost:8888\/?$/)
  })

  test('keeps non-sensitive query params', () => {
    const redacted = redactUrlForStatus('http://localhost:8888?model=llama3')
    expect(redacted).toMatch(/^http:\/\/localhost:8888\/?\?model=llama3$/)
  })

  test('still redacts creds when the URL is malformed (regex fallback)', () => {
    // No scheme -> `new URL()` throws; redactUrlForDisplay falls back to a
    // regex that must still scrub the userinfo.
    const redacted = redactUrlForStatus('//alice:secret@proxy.example.com:8080')

    expect(redacted).not.toContain('alice')
    expect(redacted).not.toContain('secret')
    expect(redacted).toContain('redacted')
  })

  test('returns empty string as-is', () => {
    expect(redactUrlForStatus('')).toBe('')
  })
})

describe('redactPathForStatus', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('utils/statusRedaction.test.ts')
    process.env.HOME = REAL_HOMEDIR
    restoreEnvValue('USERPROFILE', ORIGINAL_USERPROFILE)
  })

  afterEach(() => {
    try {
      // Defensive: tests below mutate env. Restore so subsequent suites see
      // the real environment.
      restoreEnvValue('HOME', ORIGINAL_HOME)
      restoreEnvValue('USERPROFILE', ORIGINAL_USERPROFILE)
    } finally {
      releaseSharedMutationLock()
    }
  })

  test('shortens POSIX home directory paths to ~', () => {
    process.env.HOME = REAL_HOMEDIR
    const result = redactPathForStatus(`${REAL_HOMEDIR}/secrets/client.key`)
    expect(result).toBe('~/secrets/client.key')
    expect(result).not.toContain(REAL_HOMEDIR)
  })

  test('handles the home directory exactly', () => {
    process.env.HOME = REAL_HOMEDIR
    expect(redactPathForStatus(REAL_HOMEDIR)).toBe('~')
  })

  test('redacts via USERPROFILE when HOME does not match (Windows-style)', () => {
    // Simulate a Windows path where HOME is unset/irrelevant but
    // USERPROFILE points at the profile dir. On a POSIX test host
    // os.homedir() returns the POSIX home and would mask this case,
    // so unset HOME to prove USERPROFILE is consulted independently.
    const fakeProfile = 'C:\\Users\\bob'
    delete process.env.HOME
    process.env.USERPROFILE = fakeProfile
    const result = redactPathForStatus(`${fakeProfile}\\secrets\\client.key`)
    expect(result).toBe('~\\secrets\\client.key')
    expect(result).not.toContain('bob')
  })

  test('redacts Windows home paths when path casing differs', () => {
    const fakeProfile = 'C:\\Users\\Bob'
    delete process.env.HOME
    process.env.USERPROFILE = fakeProfile
    const result = redactPathForStatus('c:\\users\\bob\\secrets\\client.key')
    expect(result).toBe('~\\secrets\\client.key')
    expect(result.toLowerCase()).not.toContain('bob')
  })

  test('falls back to os.homedir() when HOME and USERPROFILE are unset', () => {
    // Container/sandbox scenario: no env hints, rely on the OS passwd db.
    delete process.env.HOME
    delete process.env.USERPROFILE
    const osHome = homedir()
    // Skip on hosts where os.homedir() is '/' (filtered out by the helper).
    if (!osHome || osHome === '/') return
    const result = redactPathForStatus(`${osHome}/.config/client.key`)
    expect(result).toBe('~/.config/client.key')
    expect(result).not.toContain(osHome)
  })

  test('does not redact a path that merely contains "home" as a segment', () => {
    // E.g. `/opt/home/backup/ca.crt` — substring match must not trigger.
    expect(redactPathForStatus('/opt/home/backup/ca.crt')).toBe(
      '/opt/home/backup/ca.crt',
    )
  })

  test('leaves non-home absolute paths unchanged', () => {
    expect(redactPathForStatus('/etc/ssl/certs/ca-certificates.crt')).toBe(
      '/etc/ssl/certs/ca-certificates.crt',
    )
  })

  test('returns empty string as-is', () => {
    expect(redactPathForStatus('')).toBe('')
  })
})
