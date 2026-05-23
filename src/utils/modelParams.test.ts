import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { applyProviderProfileToProcessEnv } from './providerProfiles.js'
import { getContextWindowForModel } from './context.ts'
import { resolveAgentProvider } from '../services/api/agentRouting.ts'
import { getAutoCompactThreshold, getEffectiveContextWindowSize } from '../services/compact/autoCompact.ts'

describe('Model Parameter Configuration', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear relevant env vars to ensure hermetic tests
    delete process.env.CLAUDE_CODE_TEMPERATURE
    delete process.env.CLAUDE_CODE_TOP_P
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    delete process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_MODEL
    delete process.env.USER_TYPE
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('ProviderProfile respects temperature and top_p', () => {
    const profile = {
      id: 'test-profile',
      name: 'Test Profile',
      provider: 'openai' as any,
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      temperature: 0.2,
      top_p: 0.85,
    }

    applyProviderProfileToProcessEnv(profile)

    expect(process.env.CLAUDE_CODE_TEMPERATURE).toBe('0.2')
    expect(process.env.CLAUDE_CODE_TOP_P).toBe('0.85')
  })

  test('agentRouting respects temperature and top_p', () => {
    const settings = {
      agentRouting: {
        'test-agent': 'test-model',
      },
      agentModels: {
        'test-model': {
          base_url: 'https://api.example.com/v1',
          api_key: 'sk-test',
          temperature: 0.3,
          top_p: 0.7,
        },
      },
    } as any

    const override = resolveAgentProvider('test-agent', undefined, settings)
    expect(override).not.toBeNull()
    expect(override?.temperature).toBe(0.3)
    expect(override?.top_p).toBe(0.7)
  })

  test('getContextWindowForModel supports explicit override', () => {
    expect(getContextWindowForModel('any-model', [], 50000)).toBe(50000)
  })

  test('temperature: 0 is correctly handled', () => {
    const profile = {
      id: 'test-profile-0',
      name: 'Test Profile 0',
      provider: 'openai' as any,
      baseUrl: 'https://api.example.com/v1',
      model: 'test-model',
      temperature: 0,
    }
    applyProviderProfileToProcessEnv(profile)
    expect(process.env.CLAUDE_CODE_TEMPERATURE).toBe('0')
  })
})
