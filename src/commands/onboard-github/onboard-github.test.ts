import { describe, expect, test } from 'bun:test'

import {
  hasExistingGithubModelsLoginToken,
  shouldForceGithubRelogin,
} from './onboard-github.js'

describe('shouldForceGithubRelogin', () => {
  test.each(['force', '--force', 'relogin', '--relogin', 'reauth', '--reauth'])(
    'treats %s as force re-login',
    arg => {
      expect(shouldForceGithubRelogin(arg)).toBe(true)
    },
  )

  test('returns false for empty or unknown args', () => {
    expect(shouldForceGithubRelogin('')).toBe(false)
    expect(shouldForceGithubRelogin(undefined)).toBe(false)
    expect(shouldForceGithubRelogin('something-else')).toBe(false)
  })
})

describe('hasExistingGithubModelsLoginToken', () => {
  test('returns true when GITHUB_TOKEN is present', () => {
    expect(
      hasExistingGithubModelsLoginToken({ GITHUB_TOKEN: 'token' }, ''),
    ).toBe(true)
  })

  test('returns true when GH_TOKEN is present', () => {
    expect(
      hasExistingGithubModelsLoginToken({ GH_TOKEN: 'token' }, ''),
    ).toBe(true)
  })

  test('returns true when stored token exists', () => {
    expect(hasExistingGithubModelsLoginToken({}, 'stored-token')).toBe(true)
  })

  test('returns false when both env and stored token are missing', () => {
    expect(hasExistingGithubModelsLoginToken({}, '')).toBe(false)
  })
})
