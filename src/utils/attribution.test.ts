import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getClientType, setClientType } from '../bootstrap/state.js'
import {
  getAttributionTexts,
  getDefaultCommitCoAuthorEmail,
  getDefaultCommitCoAuthorName,
  getEnhancedPRAttribution,
} from './attribution.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from './settings/settingsCache.js'
import type { SettingsJson } from './settings/types.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENCLAUDE_DISABLE_CO_AUTHORED_BY:
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY,
  CLAUDE_CODE_REMOTE_SESSION_ID: process.env.CLAUDE_CODE_REMOTE_SESSION_ID,
  SESSION_INGRESS_URL: process.env.SESSION_INGRESS_URL,
  USER_TYPE: process.env.USER_TYPE,
}
const originalClientType = getClientType()

const defaultPrAttribution =
  '🤖 Generated with [OpenClaude](https://github.com/Gitlawb/openclaude)'

function useSettings(settings: SettingsJson): void {
  setSessionSettingsCache({ settings, errors: [] })
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(() => {
  resetSettingsCache()
  setClientType('cli')
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  delete process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  delete process.env.SESSION_INGRESS_URL
  delete process.env.USER_TYPE
})

afterEach(() => {
  resetSettingsCache()
  setClientType(originalClientType)
  restoreEnv()
})

describe('getDefaultCommitCoAuthorName', () => {
  it('does not label unknown non-Claude provider models as Opus', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: false,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('does not apply internal Claude formatting to non-Claude providers', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: true,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('keeps the codename-safe fallback for unknown first-party models', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'unreleased-internal-model',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('sanitizes unknown internal Claude co-author names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'bad\nmodel<id>',
        apiProvider: 'firstParty',
        isInternalRepo: true,
      }),
    ).toBe('Claude (bad model id)')
  })

  it('does not duplicate the Claude prefix for Claude model names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'claude-opus-4-6',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('uses the OpenClaude email for commit attribution across providers', () => {
    expect(getDefaultCommitCoAuthorEmail('openai')).toBe(
      'openclaude@gitlawb.com',
    )
    expect(getDefaultCommitCoAuthorEmail('firstParty')).toBe(
      'openclaude@gitlawb.com',
    )
  })
})

describe('getAttributionTexts', () => {
  it('returns no commit or PR attribution when no attribution settings are configured', () => {
    useSettings({})

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom commit attribution exactly and keeps omitted PR attribution off', () => {
    useSettings({
      attribution: { commit: 'Signed-off-by: Human <h@example.com>' },
    })

    expect(getAttributionTexts()).toEqual({
      commit: 'Signed-off-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('keeps commit attribution off when configured as an empty string', () => {
    useSettings({ attribution: { commit: '' } })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom PR attribution exactly and keeps omitted commit attribution off', () => {
    useSettings({ attribution: { pr: 'Reviewed by release engineering.' } })

    expect(getAttributionTexts()).toEqual({
      commit: '',
      pr: 'Reviewed by release engineering.',
    })
  })

  it('keeps PR attribution off when configured as an empty string', () => {
    useSettings({ attribution: { pr: '' } })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('preserves includeCoAuthoredBy true as an explicit old-default opt-in', () => {
    useSettings({ includeCoAuthoredBy: true })

    expect(getAttributionTexts()).toEqual({
      commit: 'Co-Authored-By: OpenClaude (gpt-5.5) <openclaude@gitlawb.com>',
      pr: defaultPrAttribution,
    })
  })

  it('keeps attribution off when includeCoAuthoredBy is false', () => {
    useSettings({ includeCoAuthoredBy: false })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('uses OPENCLAUDE_DISABLE_CO_AUTHORED_BY to disable the old default co-author trailer', () => {
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({ includeCoAuthoredBy: true })

    expect(getAttributionTexts()).toEqual({
      commit: '',
      pr: defaultPrAttribution,
    })
  })

  it('does not let OPENCLAUDE_DISABLE_CO_AUTHORED_BY override explicit commit attribution', () => {
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({
      attribution: { commit: 'Reviewed-by: Human <h@example.com>' },
    })

    expect(getAttributionTexts()).toEqual({
      commit: 'Reviewed-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('preserves remote session attribution separately from local git attribution defaults', () => {
    setClientType('remote')
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'session_remote_123'
    useSettings({})

    expect(getAttributionTexts()).toEqual({
      commit: 'https://claude.ai/code/session_remote_123',
      pr: 'https://claude.ai/code/session_remote_123',
    })
  })
})

describe('getEnhancedPRAttribution', () => {
  it('returns no PR attribution when no attribution settings are configured', async () => {
    useSettings({})

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read when attribution is off')
      }),
    ).resolves.toBe('')
  })

  it('honors custom PR attribution exactly', async () => {
    useSettings({ attribution: { pr: 'PR reviewed under repo policy.' } })

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for custom attribution')
      }),
    ).resolves.toBe('PR reviewed under repo policy.')
  })

  it('honors explicit empty PR attribution exactly', async () => {
    useSettings({ attribution: { pr: '' } })

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for empty attribution')
      }),
    ).resolves.toBe('')
  })

  it('preserves includeCoAuthoredBy true as an explicit opt-in to generated PR attribution', async () => {
    useSettings({ includeCoAuthoredBy: true })

    await expect(getEnhancedPRAttribution(() => ({} as never))).resolves.toBe(
      defaultPrAttribution,
    )
  })
})
