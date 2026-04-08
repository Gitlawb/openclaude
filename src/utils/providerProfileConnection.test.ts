import { afterEach, describe, expect, mock, test } from 'bun:test'

import type { ProviderProfileInput } from './providerProfiles.js'

const originalEnv = { ...process.env }

function restoreEnv(): void {
  process.env = { ...originalEnv }
}

async function importFreshModule() {
  return import(`./providerProfileConnection.js?ts=${Date.now()}-${Math.random()}`)
}

describe('testProviderProfileConnection', () => {
  afterEach(() => {
    restoreEnv()
    mock.restore()
  })

  test('uses anthropic env for anthropic profiles and restores previous env', async () => {
    const { testProviderProfileConnection } = await importFreshModule()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1'
    process.env.OPENAI_MODEL = 'old-model'
    process.env.OPENAI_API_KEY = 'old-key'
    process.env.OPENAI_ORG = 'old-org'

    const validateModel = mock(async (model: string) => {
      expect(model).toBe('claude-sonnet-4-6')
      expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com')
      expect(process.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-6')
      expect(process.env.ANTHROPIC_API_KEY).toBe('anthropic-key')
      expect(process.env.OPENAI_ORG).toBeUndefined()
      return { valid: true }
    })

    const result = await testProviderProfileConnection(
      {
        provider: 'anthropic',
        name: 'Anthropic Custom',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
        apiKey: 'anthropic-key',
      },
      { validateModel },
    )

    expect(result).toEqual({ ok: true })
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
    expect(process.env.OPENAI_BASE_URL).toBe('https://api.example.com/v1')
    expect(process.env.OPENAI_MODEL).toBe('old-model')
    expect(process.env.OPENAI_API_KEY).toBe('old-key')
    expect(process.env.OPENAI_ORG).toBe('old-org')
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  test('uses openai env for openai-compatible profiles and returns validation errors', async () => {
    const { testProviderProfileConnection } = await importFreshModule()
    delete process.env.CLAUDE_CODE_USE_OPENAI

    const validateModel = mock(async () => {
      expect(process.env.CLAUDE_CODE_USE_OPENAI).toBe('1')
      expect(process.env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1')
      expect(process.env.OPENAI_MODEL).toBe('gpt-4o-mini')
      expect(process.env.OPENAI_API_KEY).toBe('openai-key')
      return { valid: false, error: 'Authentication failed.' }
    })

    const result = await testProviderProfileConnection(
      {
        provider: 'openai',
        name: 'Custom OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: 'openai-key',
      },
      { validateModel },
    )

    expect(result).toEqual({ ok: false, message: 'Authentication failed.' })
    expect(process.env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
    expect(process.env.OPENAI_BASE_URL).toBeUndefined()
    expect(process.env.OPENAI_MODEL).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test('suppresses OAuth tokens during validation so API key is exercised', async () => {
    const { testProviderProfileConnection } = await importFreshModule()
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-value'
    process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR = '3'

    const validateModel = mock(async () => {
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      expect(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBeUndefined()
      return { valid: true }
    })

    const result = await testProviderProfileConnection(
      {
        provider: 'anthropic',
        name: 'Test OAuth Bypass',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
        apiKey: 'my-api-key',
      },
      { validateModel },
    )

    expect(result).toEqual({ ok: true })
    // OAuth env vars should be restored after the test
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token-value')
    expect(process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR).toBe('3')
  })

  test('returns error message when validateModel throws', async () => {
    const { testProviderProfileConnection } = await importFreshModule()

    const validateModel = mock(async () => {
      throw new Error('Network timeout')
    })

    const result = await testProviderProfileConnection(
      {
        provider: 'openai',
        name: 'Throwing provider',
        baseUrl: 'https://api.example.com/v1',
        model: 'some-model',
        apiKey: 'key',
      },
      { validateModel },
    )

    expect(result).toEqual({ ok: false, message: 'Network timeout' })
  })

  test('requires model and base url before testing', async () => {
    const { testProviderProfileConnection } = await importFreshModule()

    const result = await testProviderProfileConnection({
      provider: 'openai',
      name: 'Incomplete',
      baseUrl: '',
      model: '',
      apiKey: '',
    } as ProviderProfileInput)

    expect(result).toEqual({
      ok: false,
      message: 'Base URL and model are required before testing the provider.',
    })
  })
})
