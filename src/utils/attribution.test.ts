import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  getClientType,
  resetStateForTests,
  setClientType,
} from '../bootstrap/state.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from './settings/settingsCache.js'
import type { SettingsJson } from './settings/types.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  OPENCLAUDE_DISABLE_CO_AUTHORED_BY:
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY,
  CLAUDE_CODE_REMOTE_SESSION_ID: process.env.CLAUDE_CODE_REMOTE_SESSION_ID,
  SESSION_INGRESS_URL: process.env.SESSION_INGRESS_URL,
  USER_TYPE: process.env.USER_TYPE,
}
const originalClientType = getClientType()
let attributionModule: typeof import('./attribution.js')

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

beforeEach(async () => {
  mock.restore()
  resetStateForTests()
  resetSettingsCache()
  setClientType('cli')
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.ANTHROPIC_MODEL
  delete process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  delete process.env.SESSION_INGRESS_URL
  delete process.env.USER_TYPE
  attributionModule = await import('./attribution.js')
})

afterEach(() => {
  mock.restore()
  resetStateForTests()
  resetSettingsCache()
  setClientType(originalClientType)
  restoreEnv()
})

describe('getDefaultCommitCoAuthorName', () => {
  it('does not label unknown non-Claude provider models as Opus', () => {
    expect(
      attributionModule.getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: false,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('does not apply internal Claude formatting to non-Claude providers', () => {
    expect(
      attributionModule.getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: true,
      }),
    ).toBe('OpenClaude (gpt-5.5)')
  })

  it('keeps the codename-safe fallback for unknown first-party models', () => {
    expect(
      attributionModule.getDefaultCommitCoAuthorName({
        model: 'unreleased-internal-model',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('sanitizes unknown internal Claude co-author names', () => {
    expect(
      attributionModule.getDefaultCommitCoAuthorName({
        model: 'bad\nmodel<id>',
        apiProvider: 'firstParty',
        isInternalRepo: true,
      }),
    ).toBe('Claude (bad model id)')
  })

  it('does not duplicate the Claude prefix for Claude model names', () => {
    expect(
      attributionModule.getDefaultCommitCoAuthorName({
        model: 'claude-opus-4-6',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('uses the OpenClaude email for commit attribution across providers', () => {
    expect(attributionModule.getDefaultCommitCoAuthorEmail('openai')).toBe(
      'openclaude@gitlawb.com',
    )
    expect(attributionModule.getDefaultCommitCoAuthorEmail('firstParty')).toBe(
      'openclaude@gitlawb.com',
    )
  })
})

describe('getAttributionTexts', () => {
  it('returns no commit or PR attribution when no attribution settings are configured', () => {
    useSettings({})

    expect(attributionModule.getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom commit attribution exactly and keeps omitted PR attribution off', () => {
    useSettings({
      attribution: { commit: 'Signed-off-by: Human <h@example.com>' },
    })

    expect(attributionModule.getAttributionTexts()).toEqual({
      commit: 'Signed-off-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('keeps commit attribution off when configured as an empty string', () => {
    useSettings({ attribution: { commit: '' } })

    expect(attributionModule.getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom PR attribution exactly and keeps omitted commit attribution off', () => {
    useSettings({ attribution: { pr: 'Reviewed by release engineering.' } })

    expect(attributionModule.getAttributionTexts()).toEqual({
      commit: '',
      pr: 'Reviewed by release engineering.',
    })
  })

  it('keeps PR attribution off when configured as an empty string', () => {
    useSettings({ attribution: { pr: '' } })

    expect(attributionModule.getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('preserves includeCoAuthoredBy true as an explicit old-default opt-in', () => {
    useSettings({ includeCoAuthoredBy: true })

    const attribution = attributionModule.getAttributionTexts()
    expect(attribution.commit).toStartWith('Co-Authored-By: ')
    expect(attribution.commit).toEndWith(' <openclaude@gitlawb.com>')
    expect(attribution.pr).toBe(defaultPrAttribution)
  })

  it('keeps attribution off when includeCoAuthoredBy is false', () => {
    useSettings({ includeCoAuthoredBy: false })

    expect(attributionModule.getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('uses OPENCLAUDE_DISABLE_CO_AUTHORED_BY to disable the old default co-author trailer', () => {
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({ includeCoAuthoredBy: true })

    expect(attributionModule.getAttributionTexts()).toEqual({
      commit: '',
      pr: defaultPrAttribution,
    })
  })

  it('does not let OPENCLAUDE_DISABLE_CO_AUTHORED_BY override explicit commit attribution', () => {
    process.env.OPENCLAUDE_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({
      attribution: { commit: 'Reviewed-by: Human <h@example.com>' },
    })

    expect(attributionModule.getAttributionTexts()).toEqual({
      commit: 'Reviewed-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('preserves remote session attribution separately from local git attribution defaults', () => {
    setClientType('remote')
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'session_remote_123'
    useSettings({})

    expect(attributionModule.getAttributionTexts()).toEqual({
      commit: 'https://claude.ai/code/session_remote_123',
      pr: 'https://claude.ai/code/session_remote_123',
    })
  })
})

describe('getEnhancedPRAttribution', () => {
  it('returns no PR attribution when no attribution settings are configured', async () => {
    useSettings({})

    await expect(
      attributionModule.getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read when attribution is off')
      }),
    ).resolves.toBe('')
  })

  it('honors custom PR attribution exactly', async () => {
    useSettings({ attribution: { pr: 'PR reviewed under repo policy.' } })

    await expect(
      attributionModule.getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for custom attribution')
      }),
    ).resolves.toBe('PR reviewed under repo policy.')
  })

  it('honors explicit empty PR attribution exactly', async () => {
    useSettings({ attribution: { pr: '' } })

    await expect(
      attributionModule.getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for empty attribution')
      }),
    ).resolves.toBe('')
  })

  it('preserves includeCoAuthoredBy true as an explicit opt-in to generated PR attribution', async () => {
    useSettings({ includeCoAuthoredBy: true })

    await expect(
      attributionModule.getEnhancedPRAttribution(() => ({} as never)),
    ).resolves.toBe(
      defaultPrAttribution,
    )
  })
})
