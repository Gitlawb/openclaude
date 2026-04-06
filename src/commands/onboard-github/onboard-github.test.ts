import { describe, expect, test } from 'bun:test'

import {
  applyGithubOnboardingProcessEnv,
  buildGithubOnboardingSettingsEnv,
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

describe('onboarding auth precedence cleanup', () => {
  test('clears preexisting OpenAI auth when switching to GitHub', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_API_KEY: 'sk-stale-openai-key',
      OPENAI_ORG: 'org-old',
      OPENAI_PROJECT: 'project-old',
      OPENAI_ORGANIZATION: 'org-legacy',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_BASE: 'https://api.openai.com/v1',
      CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED: '1',
      CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID: 'profile_old',
    }

    applyGithubOnboardingProcessEnv('github:copilot', env)

    expect(env.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(env.OPENAI_MODEL).toBe('github:copilot')

    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.OPENAI_ORG).toBeUndefined()
    expect(env.OPENAI_PROJECT).toBeUndefined()
    expect(env.OPENAI_ORGANIZATION).toBeUndefined()
    expect(env.OPENAI_BASE_URL).toBeUndefined()
    expect(env.OPENAI_API_BASE).toBeUndefined()

    expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED).toBeUndefined()
    expect(env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID).toBeUndefined()

    const settingsEnv = buildGithubOnboardingSettingsEnv('github:copilot')
    expect(settingsEnv.CLAUDE_CODE_USE_GITHUB).toBe('1')
    expect(settingsEnv.OPENAI_MODEL).toBe('github:copilot')
    expect(settingsEnv.OPENAI_API_KEY).toBeUndefined()
    expect(settingsEnv.OPENAI_ORG).toBeUndefined()
    expect(settingsEnv.OPENAI_PROJECT).toBeUndefined()
    expect(settingsEnv.OPENAI_ORGANIZATION).toBeUndefined()
  })
})
